// GET  /api/orders  — list new orders (owner only)
// POST /api/orders  — place a new order (customer)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // secret key
const OWNER_KEY    = process.env.OWNER_KEY;

const db = (path, opt = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opt,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...(opt.headers || {}),
    },
  });

export default async function handler(req, res) {
  // CORS (needed if frontend & backend on different domains)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─ GET: owner fetches all new orders ───────────────────────────
  if (req.method === 'GET') {
    if (req.headers['x-owner-key'] !== OWNER_KEY)
      return res.status(401).json({ error: 'Unauthorized' });

    const r = await db('orders?status=eq.new&order=created_at.desc');
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // ─ POST: customer places an order ─────────────────────────────
  if (req.method === 'POST') {
    const { table, items, note, idempotencyKey } = req.body || {};
    if (!table || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'table and items are required' });

    const total = items.reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);

    const r = await db('orders', {
      method: 'POST',
      body: JSON.stringify({
        table_no:         Number(table),
        items:            items,
        note:             note || '',
        total:            total,
        status:           'new',
        idempotency_key:  idempotencyKey || null,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data[0]?.message || 'DB error' });

    const row = Array.isArray(data) ? data[0] : data;
    return res.status(201).json({
      id:       row.id,
      orderNo:  row.order_no,
      total:    row.total,
      status:   row.status,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
