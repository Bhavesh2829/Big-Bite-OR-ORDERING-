// GET  /api/orders      -- list new/preparing orders (owner only)
// POST /api/orders      -- place a new order (customer)
// PATCH /api/orders/:id -- handled in orders/[id].js
​
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // must be service_role key
const OWNER_KEY    = process.env.OWNER_KEY;
​
function supabase(path, opt) {
  opt = opt || {};
  return fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, opt, {
    headers: Object.assign({
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    }, opt.headers || {}),
  }));
}
​
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
​
  // ── GET: owner fetches all active orders ──────────────────────────────
  if (req.method === 'GET') {
    if (req.headers['x-owner-key'] !== OWNER_KEY)
      return res.status(401).json({ error: 'Unauthorized' });
​
    try {
      // Fetch new + preparing orders, newest first
      const r = await supabase(
        'orders?status=in.("new","preparing")&order=created_at.desc'
      );
      const raw = await r.json();
​
      if (!r.ok) {
        console.error('[GET /api/orders] Supabase error:', raw);
        return res.status(500).json({
          error: 'Database error',
          detail: Array.isArray(raw) ? raw[0]?.message : raw?.message || JSON.stringify(raw),
        });
      }
​
      // Normalise field names for the dashboard
      const data = (Array.isArray(raw) ? raw : []).map(o => ({
        id:        o.id,
        orderNo:   o.order_no,
        table:     o.table_no,
        items:     o.items,
        note:      o.note,
        total:     o.total,
        status:    o.status,
        createdAt: o.created_at,
      }));
​
      return res.status(200).json(data);
    } catch (e) {
      console.error('[GET /api/orders] Unexpected error:', e);
      return res.status(500).json({ error: 'Server error', detail: e.message });
    }
  }
​
  // ── POST: customer places a new order ─────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const { table, items, note, idempotencyKey } = body;
​
      // Validate
      if (!table)
        return res.status(400).json({ error: 'table is required' });
      if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ error: 'items must be a non-empty array' });
​
      // Calculate total -- items from the menu include price; fallback to 0
      const total = items.reduce(function(sum, i) {
        return sum + (Number(i.price) || 0) * (Number(i.qty) || 1);
      }, 0);
​
      const payload = {
        table_no:        Number(table),
        items:           items,
        note:            (note || '').trim(),
        total:           total,
        status:          'new',
        idempotency_key: idempotencyKey || null,
      };
​
      const r = await supabase('orders', {
        method: 'POST',
        body:   JSON.stringify(payload),
      });
​
      const raw = await r.json();
​
      if (!r.ok) {
        console.error('[POST /api/orders] Supabase error:', raw);
        const msg = Array.isArray(raw) ? raw[0]?.message : raw?.message;
        const hint = Array.isArray(raw) ? raw[0]?.hint : raw?.hint;
        return res.status(500).json({
          error:  msg  || 'DB error',
          hint:   hint || null,
          detail: JSON.stringify(raw),
        });
      }
​
      const row = Array.isArray(raw) ? raw[0] : raw;
      return res.status(201).json({
        id:      row.id,
        orderNo: row.order_no,
        total:   row.total,
        status:  row.status,
      });
​
    } catch (e) {
      console.error('[POST /api/orders] Unexpected error:', e);
      return res.status(500).json({ error: 'Server error', detail: e.message });
    }
  }
​
  return res.status(405).json({ error: 'Method not allowed' });
}
​