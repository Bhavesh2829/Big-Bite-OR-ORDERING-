// GET   /api/orders      - owner only: list active (new + preparing) orders
// POST  /api/orders      - customer: place a new order
// PATCH /api/orders/:id  - handled in api/orders/[id].js
//
// Tables used: tables, menu_items, orders, order_items

import { timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;   // service_role key (server only, never in HTML)
const OWNER_KEY    = process.env.OWNER_KEY;

// QR signature check. OFF by default. Set REQUIRE_SIG=on in Vercel once your QR links include &sig=...
const REQUIRE_SIG = (process.env.REQUIRE_SIG || 'off').toLowerCase() === 'on';

// Extra charges added to the menu price. Set your real prices here.
const SIZE_EXTRA         = { small: 0, medium: 0, large: 0 };
const EXTRA_CHEESE_PRICE = 0;

/* ---------- helpers ---------- */

const round2 = n => Math.round(n * 100) / 100;

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function configProblem(needOwnerKey) {
  if (!/^https?:\/\//.test(SUPABASE_URL)) return 'SUPABASE_URL is missing or invalid (use https://xxxx.supabase.co)';
  if (!SUPABASE_KEY)                       return 'SUPABASE_KEY is missing';
  if (needOwnerKey && !OWNER_KEY)          return 'OWNER_KEY is missing';
  return null;
}

function isOwner(req) {
  return Boolean(OWNER_KEY) && safeEqual(req.headers['x-owner-key'], OWNER_KEY);
}

async function sb(path, opt = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opt,
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=representation',
      ...(opt.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: res.ok, status: res.status, body };
}

function dbError(body) {
  const b = Array.isArray(body) ? body[0] : body;
  return {
    message: (b && b.message) || (typeof body === 'string' && body.slice(0, 200)) || 'Database error',
    hint:    (b && b.hint) || null,
    code:    (b && b.code) || null,
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

/* ---------- GET: owner lists active orders ---------- */

async function listOrders(req, res) {
  if (!isOwner(req)) return res.status(401).json({ error: 'Unauthorized' });

  const qs = new URLSearchParams({
    select: 'id,order_no,status,note,total,created_at,tables(table_number),' +
            'order_items(item_name,size,extra_cheese,quantity,unit_price,line_total)',
    status: 'in.(new,preparing)',
    order:  'created_at.desc',
    limit:  '200',
  });
  const r = await sb('orders?' + qs.toString());

  if (!r.ok) {
    const e = dbError(r.body);
    console.error('[GET /api/orders] Supabase error:', r.status, r.body);
    return res.status(500).json({ error: 'Database error', detail: e.message, hint: e.hint, code: e.code });
  }

  const rows = Array.isArray(r.body) ? r.body : [];
  return res.status(200).json(rows.map(o => ({
    id:        o.id,
    orderNo:   o.order_no,
    table:     o.tables ? o.tables.table_number : null,
    items:     (o.order_items || []).map(i => ({
      name:      i.item_name,
      size:      i.size,
      extraCheese: i.extra_cheese,
      qty:       i.quantity,
      price:     i.unit_price,
      lineTotal: i.line_total,
    })),
    note:      o.note,
    total:     o.total,
    status:    o.status,
    createdAt: o.created_at,
  })));
}

/* ---------- POST: customer places an order ---------- */

async function findByKey(key) {
  const q = new URLSearchParams({ idempotency_key: 'eq.' + key, select: 'id,public_token,order_no,total,status', limit: '1' });
  const r = await sb('orders?' + q.toString());
  return r.ok && Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}

async function createOrder(req, res) {
  const { table, sig, items, note, idempotencyKey } = parseBody(req);

  /* 1. table + QR signature */
  const tableNo = Number(table);
  if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 999)
    return res.status(400).json({ error: 'A valid table number is required' });

  const t = await sb('tables?' + new URLSearchParams({
    table_number: 'eq.' + tableNo, select: 'id,table_number,qr_signature,is_active', limit: '1',
  }).toString());
  if (!t.ok) {
    const e = dbError(t.body);
    console.error('[POST /api/orders] tables lookup failed:', t.status, t.body);
    return res.status(500).json({ error: e.message, hint: e.hint, code: e.code });
  }
  const tableRow = Array.isArray(t.body) ? t.body[0] : null;
  if (!tableRow || !tableRow.is_active)
    return res.status(400).json({ error: 'This table is not available' });
  if (REQUIRE_SIG && !safeEqual(String(sig || ''), String(tableRow.qr_signature || '')))
    return res.status(403).json({ error: 'Invalid QR code. Please scan the QR on your table again.' });

  /* 2. basic item checks */
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'items must be a non-empty array' });
  if (items.length > 50)
    return res.status(400).json({ error: 'Too many items in one order' });

  /* 3. duplicate submit (double tap / retry): return the first order */
  const key = typeof idempotencyKey === 'string' && idempotencyKey ? idempotencyKey.slice(0, 100) : null;
  if (key) {
    const row = await findByKey(key);
    if (row) return res.status(200).json({ id: row.public_token, orderNo: row.order_no, total: row.total, status: row.status });
  }

  /* 4. real prices come from menu_items, never from the phone */
  const m = await sb('menu_items?select=id,name,price,is_available&limit=1000');
  if (!m.ok) {
    const e = dbError(m.body);
    console.error('[POST /api/orders] menu lookup failed:', m.status, m.body);
    return res.status(500).json({ error: e.message, hint: e.hint, code: e.code });
  }
  const menu = Array.isArray(m.body) ? m.body : [];
  const byId   = new Map(menu.map(x => [String(x.id), x]));
  const byName = new Map(menu.map(x => [String(x.name).trim().toLowerCase(), x]));

  const lines = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return res.status(400).json({ error: 'Invalid item' });

    const wantedId   = raw.id ?? raw.menuItemId ?? raw.menu_item_id;
    const wantedName = String(raw.name ?? raw.base ?? '').trim();
    const menuItem   = (wantedId != null && byId.get(String(wantedId))) || byName.get(wantedName.toLowerCase());
    if (!menuItem) return res.status(400).json({ error: 'Item not found: ' + (wantedName || wantedId || 'unknown') });
    if (!menuItem.is_available) return res.status(409).json({ error: menuItem.name + ' is currently unavailable' });

    const qty = Math.floor(Number(raw.qty ?? raw.quantity ?? 1));
    if (!(qty >= 1 && qty <= 99)) return res.status(400).json({ error: 'Invalid quantity for ' + menuItem.name });

    const size   = raw.size ? String(raw.size).trim().slice(0, 30) : null;
    const cheese = Boolean(raw.extraCheese ?? raw.extra_cheese);
    const unit   = round2(
      Number(menuItem.price) +
      (size ? (SIZE_EXTRA[size.toLowerCase()] || 0) : 0) +
      (cheese ? EXTRA_CHEESE_PRICE : 0)
    );

    lines.push({
      menu_item_id: menuItem.id,
      item_name:    menuItem.name,
      size,
      extra_cheese: cheese,
      quantity:     qty,
      unit_price:   unit,
      line_total:   round2(unit * qty),
    });
  }
  const total = round2(lines.reduce((s, l) => s + l.line_total, 0));

  /* 5. save the order */
  const payload = {
    table_id: tableRow.id,
    status:   'new',
    note:     String(note || '').trim().slice(0, 300),
    total,
  };
  if (key) payload.idempotency_key = key;

  const o = await sb('orders', { method: 'POST', body: JSON.stringify(payload) });
  if (!o.ok) {
    // Two identical requests at the same moment: the unique key stops the 2nd one
    if (key && dbError(o.body).code === '23505') {
      const row = await findByKey(key);
      if (row) return res.status(200).json({ id: row.public_token, orderNo: row.order_no, total: row.total, status: row.status });
    }
    const e = dbError(o.body);
    console.error('[POST /api/orders] order insert failed:', o.status, o.body);
    return res.status(500).json({ error: e.message, hint: e.hint, code: e.code });
  }
  const order = Array.isArray(o.body) ? o.body[0] : o.body;

  /* 6. save the items; if this fails, remove the empty order */
  const oi = await sb('order_items', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(lines.map(l => ({ ...l, order_id: order.id }))),
  });
  if (!oi.ok) {
    console.error('[POST /api/orders] order_items insert failed:', oi.status, oi.body);
    await sb('orders?id=eq.' + order.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    const e = dbError(oi.body);
    return res.status(500).json({ error: e.message, hint: e.hint, code: e.code });
  }

  return res.status(201).json({ id: order.public_token, orderNo: order.order_no, total: order.total, status: order.status });
}

/* ---------- entry point ---------- */

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const problem = configProblem(req.method === 'GET');
    if (problem) {
      console.error('[/api/orders] Config error:', problem);
      return res.status(500).json({ error: 'Server is not configured', detail: problem });
    }

    if (req.method === 'GET')  return await listOrders(req, res);
    if (req.method === 'POST') return await createOrder(req, res);

    res.setHeader('Allow', 'GET,POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[/api/orders] Unexpected error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}