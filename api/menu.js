// GET  /api/menu  — list all menu items (public)
// POST /api/menu  — add menu item (owner only)

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const r = await db('menu?available=eq.true&order=category.asc,name.asc');
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'POST') {
    if (req.headers['x-owner-key'] !== OWNER_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const { name, price, category, isVeg } = req.body || {};
    if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });
    const r = await db('menu', { method: 'POST', body: JSON.stringify({ name, price: Number(price), category, is_veg: !!isVeg }) });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data[0]?.message || 'DB error' });
    return res.status(201).json(Array.isArray(data) ? data[0] : data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
