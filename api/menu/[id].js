// GET  /api/menu   - owner only: list all dishes
// POST /api/menu   - owner only: add one dish  { name, price, category, isVeg }
//                    or many dishes            { items: [ { name, price, category, isVeg }, ... ] }
// PATCH / DELETE for one dish are in api/menu/[id].js

import { timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;   // service_role key
const OWNER_KEY    = process.env.OWNER_KEY;

function configProblem() {
  if (!/^https?:\/\//.test(SUPABASE_URL)) return 'SUPABASE_URL is missing or invalid';
  if (!SUPABASE_KEY) return 'SUPABASE_KEY is missing';
  if (!OWNER_KEY)    return 'OWNER_KEY is missing';
  return null;
}

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
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
      ...(opt.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: res.ok, status: res.status, body };
}

function dbMessage(body) {
  const b = Array.isArray(body) ? body[0] : body;
  return (b && b.message) || (typeof body === 'string' && body.slice(0, 200)) || 'Database error';
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

// Returns { dish } or { error }
function cleanDish(input) {
  const d = input || {};
  const name = String(d.name ?? '').trim();
  const category = String(d.category ?? '').trim();
  const price = Number(d.price);
  if (!name || name.length > 80)           return { error: 'Dish name is required (max 80 characters)' };
  if (!category || category.length > 60)   return { error: `Category is required for "${name}"` };
  if (!Number.isInteger(price) || price < 0 || price > 100000)
    return { error: `Price for "${name}" must be a whole number of rupees` };
  return {
    dish: {
      name,
      category,
      price,
      is_veg:    (d.isVeg ?? d.is_veg) === true,
      available: d.available === false ? false : true,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const problem = configProblem();
    if (problem) {
      console.error('[/api/menu] Config error:', problem);
      return res.status(500).json({ error: 'Server is not configured', detail: problem });
    }
    if (!isOwner(req)) return res.status(401).json({ error: 'Unauthorized' });

    /* ---------- GET ---------- */
    if (req.method === 'GET') {
      const qs = new URLSearchParams({
        select: 'id,name,category,price,is_veg,available',
        order:  'category.asc,name.asc',
        limit:  '1000',
      });
      const r = await sb('menu?' + qs.toString());
      if (!r.ok) {
        console.error('[GET /api/menu]', r.status, r.body);
        return res.status(500).json({ error: dbMessage(r.body) });
      }
      return res.status(200).json(Array.isArray(r.body) ? r.body : []);
    }

    /* ---------- POST (one or many) ---------- */
    if (req.method === 'POST') {
      const body = parseBody(req);
      const bulk = Array.isArray(body.items);
      const list = bulk ? body.items : [body];

      if (list.length === 0)   return res.status(400).json({ error: 'Nothing to add' });
      if (list.length > 500)   return res.status(400).json({ error: 'Add at most 500 dishes at a time' });

      const dishes = [];
      for (const raw of list) {
        const c = cleanDish(raw);
        if (c.error) return res.status(400).json({ error: c.error });
        dishes.push(c.dish);
      }

      // Skip dishes whose name already exists (case-insensitive), also inside the batch.
      const existing = await sb('menu?' + new URLSearchParams({ select: 'name', limit: '1000' }).toString());
      if (!existing.ok) {
        console.error('[POST /api/menu] lookup', existing.status, existing.body);
        return res.status(500).json({ error: dbMessage(existing.body) });
      }
      const seen = new Set((existing.body || []).map(m => String(m.name).trim().toLowerCase()));
      const fresh = [], skipped = [];
      for (const d of dishes) {
        const k = d.name.toLowerCase();
        if (seen.has(k)) { skipped.push(d.name); continue; }
        seen.add(k);
        fresh.push(d);
      }

      if (!bulk && fresh.length === 0)
        return res.status(409).json({ error: 'Dish already exists' });
      if (fresh.length === 0)
        return res.status(200).json({ added: 0, skipped });

      const r = await sb('menu', { method: 'POST', body: JSON.stringify(fresh) });
      if (!r.ok) {
        console.error('[POST /api/menu]', r.status, r.body);
        const b = Array.isArray(r.body) ? r.body[0] : r.body;
        if (b && b.code === '23505') return res.status(409).json({ error: 'Dish already exists' });
        return res.status(500).json({ error: dbMessage(r.body) });
      }

      if (!bulk) return res.status(201).json(Array.isArray(r.body) ? r.body[0] : r.body);
      return res.status(201).json({ added: fresh.length, skipped });
    }

    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[/api/menu] Unexpected error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}