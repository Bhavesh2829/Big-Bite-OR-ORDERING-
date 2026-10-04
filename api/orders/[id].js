// GET   /api/orders/:id  — get order status (customer polls this)
// PATCH /api/orders/:id  — update order status (owner only)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;

  // ─ GET: anyone can check their order status ───────────────────
  if (req.method === 'GET') {
    const r    = await db(`orders?id=eq.${encodeURIComponent(id)}&select=id,order_no,total,status,table_no`);
    const data = await r.json();
    if (!r.ok || !data.length) return res.status(404).json({ error: 'Not found' });
    const row = data[0];
    return res.json({ id: row.id, orderNo: row.order_no, total: row.total, status: row.status });
  }

  // ─ PATCH: owner updates status ────────────────────────────
  if (req.method === 'PATCH') {
    if (req.headers['x-owner-key'] !== OWNER_KEY)
      return res.status(401).json({ error: 'Unauthorized' });

    const { status } = req.body || {};
    const allowed = ['new', 'preparing', 'ready', 'served', 'cancelled'];
    if (!allowed.includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const r    = await db(`orders?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body:   JSON.stringify({ status }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'DB error' });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
