// GET   /api/orders      - owner only: list active (new + preparing) orders
// POST  /api/orders      - customer: place a new order
// PATCH /api/orders/:id  - handled in api/orders/[id].js

import { timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;   // service_role key (server only, never in HTML)
const OWNER_KEY    = process.env.OWNER_KEY;

/* ---------- helpers ---------- */

function configProblem(needOwnerKey) {
  if (!/^https?:\/\//.test(SUPABASE_URL)) return 'SUPABASE_URL is missing or invalid (use https://xxxx.supabase.co)';
  if (!SUPABASE_KEY)                       return 'SUPABASE_KEY is missing';
  if (needOwnerKey && !OWNER_KEY)          return 'OWNER_KEY is missing';
  return null;
}

// Constant-time key check. Fails closed when OWNER_KEY is not set.
function isOwner(req) {
  const given = req.headers['x-owner-key'];
  if (!OWNER_KEY || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(OWNER_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
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
    table:     o.table_no,
    items:     o.items,
    note:      o.note,
    total:     o.total,
    status:    o.status,
    createdAt: o.created_at,
  })));
}

/* ---------- POST: customer places an order ---------- */

async function createOrder(req, res) {
  const { table, items, note, idempotencyKey } = parseBody(req);

  const tableNo = Number(table);
  if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 999)
    return res.status(400).json({ error: 'A valid table number is required' });

  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'items must be a non-empty array' });
  if (items.length > 50)
    return res.status(400).json({ error: 'Too many items in one order' });

  const clean = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return res.status(400).json({ error: 'Invalid item' });
    const name  = String(raw.name ?? raw.base ?? '').trim().slice(0, 120);
    const qty   = Math.floor(Number(raw.qty ?? raw.quantity ?? 1));
    const price = Number(raw.price ?? 0);
    if (!name || !(qty >= 1 && qty <= 99) || !Number.isFinite(price) || price < 0)
      return res.status(400).json({ error: 'Invalid item: ' + (name || 'unnamed') });
    clean.push({ ...raw, name, qty, price });
  }

  const total = Math.round(clean.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const key = typeof idempotencyKey === 'string' && idempotencyKey ? idempotencyKey.slice(0, 100) : null;

  // If the same order is sent twice (double tap / retry), return the first one.
  let useKey = Boolean(key);
  if (useKey) {
    const q = new URLSearchParams({ idempotency_key: 'eq.' + key, select: 'id,order_no,total,status', limit: '1' });
    const found = await sb('orders?' + q.toString());
    if (found.ok && Array.isArray(found.body) && found.body[0]) {
      const row = found.body[0];
      return res.status(200).json({ id: row.id, orderNo: row.order_no, total: row.total, status: row.status });
    }
    if (!found.ok) useKey = false;   // column probably missing: place the order without it
  }

  const payload = {
    table_no: tableNo,
    items:    clean,
    note:     String(note || '').trim().slice(0, 300),
    total,
    status:   'new',
  };
  if (useKey) payload.idempotency_key = key;

  const r = await sb('orders', { method: 'POST', body: JSON.stringify(payload) });

  if (!r.ok) {
    const e = dbError(r.body);
    console.error('[POST /api/orders] Supabase error:', r.status, r.body);
    return res.status(500).json({ error: e.message, hint: e.hint, code: e.code });
  }

  const row = Array.isArray(r.body) ? r.body[0] : r.body;
  return res.status(201).json({ id: row.id, orderNo: row.order_no, total: row.total, status: row.status });
}

/* ---------- entry point ---------- */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const problem = configProblem(req.method === 'GET');
    if (problem) {
      console.error('[/api/orders] Config error:', problem);
      return res.status(500).json({ error: 'Server is not configured', detail: problem });
    }

    if (req.method === 'GET')  return await listOrders(req, res);
    if (req.method === 'POST') return await createOrder(req, res);

    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[/api/orders] Unexpected error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}