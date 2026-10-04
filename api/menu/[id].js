// PATCH  /api/menu/:id  — edit menu item  (owner only)
// DELETE /api/menu/:id  — delete menu item (owner only)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OWNER_KEY    = process.env.OWNER_KEY;

const db = (path, opt = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opt,
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
      ...(opt.headers || {}),
    },
  });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.headers['x-owner-key'] !== OWNER_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.query;

  if (req.method === 'PATCH') {
    const { name, price } = req.body || {};
    const patch = {};
    if (name  !== undefined) patch.name  = name;
    if (price !== undefined) patch.price = Number(price);
    const r = await db(`menu?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!r.ok) return res.status(500).json({ error: 'DB error' });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const r = await db(`menu?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ available: false }) });
    if (!r.ok) return res.status(500).json({ error: 'DB error' });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
