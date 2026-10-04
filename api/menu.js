// GET  /api/menu - owner only: list all dishes
// POST /api/menu - owner only: add one dish { name, price, category, isVeg }
//                  or many dishes           { items: [ ... ] }
// PATCH / DELETE for one dish are in api/menu/[id].js
// Table: menu_items (id, name, category, price, is_veg, is_available, is_deleted)

import { configProblem, isOwner, sb, dbError, parseBody } from './_lib.js';

export const SELECT = 'id,name,category,price,is_veg,is_available';

export const out = r => ({
  id:        r.id,
  name:      r.name,
  category:  r.category,
  price:     Number(r.price),
  is_veg:    r.is_veg === true,
  available: r.is_available !== false,
});

function cleanDish(input) {
  const d = input || {};
  const name = String(d.name ?? '').trim();
  const category = String(d.category ?? '').trim();
  const price = Number(d.price);
  if (!name || name.length > 80)         return { error: 'Dish name is required (max 80 characters)' };
  if (!category || category.length > 60) return { error: `Category is required for "${name}"` };
  if (!Number.isInteger(price) || price < 0 || price > 100000)
    return { error: `Price for "${name}" must be a whole number of rupees` };
  return {
    dish: {
      name, category, price,
      is_veg:       (d.isVeg ?? d.is_veg) === true,
      is_available: d.available === false ? false : true,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

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
        select: SELECT,
        is_deleted: 'eq.false',
        order: 'category.asc,name.asc',
        limit: '2000',
      });
      const r = await sb('menu_items?' + qs.toString());
      if (!r.ok) {
        console.error('[GET /api/menu]', r.status, r.body);
        return res.status(500).json({ error: dbError(r.body).message });
      }
      return res.status(200).json((Array.isArray(r.body) ? r.body : []).map(out));
    }

    /* ---------- POST (one or many) ---------- */
    if (req.method === 'POST') {
      const body = parseBody(req);
      const bulk = Array.isArray(body.items);
      const list = bulk ? body.items : [body];

      if (list.length === 0) return res.status(400).json({ error: 'Nothing to add' });
      if (list.length > 500) return res.status(400).json({ error: 'Add at most 500 dishes at a time' });

      const dishes = [];
      for (const raw of list) {
        const c = cleanDish(raw);
        if (c.error) return res.status(400).json({ error: c.error });
        dishes.push(c.dish);
      }

      // Skip names that already exist (case-insensitive), also inside the batch.
      const existing = await sb('menu_items?' + new URLSearchParams({
        select: 'name', is_deleted: 'eq.false', limit: '2000',
      }).toString());
      if (!existing.ok) {
        console.error('[POST /api/menu] lookup', existing.status, existing.body);
        return res.status(500).json({ error: dbError(existing.body).message });
      }
      const seen = new Set((existing.body || []).map(m => String(m.name).trim().toLowerCase()));
      const fresh = [], skipped = [];
      for (const d of dishes) {
        const k = d.name.toLowerCase();
        if (seen.has(k)) { skipped.push(d.name); continue; }
        seen.add(k);
        fresh.push(d);
      }

      if (!bulk && fresh.length === 0) return res.status(409).json({ error: 'Dish already exists' });
      if (fresh.length === 0)          return res.status(200).json({ added: 0, skipped });

      const r = await sb('menu_items', { method: 'POST', body: JSON.stringify(fresh) });
      if (!r.ok) {
        console.error('[POST /api/menu]', r.status, r.body);
        const e = dbError(r.body);
        if (e.code === '23505') return res.status(409).json({ error: 'Dish already exists' });
        return res.status(500).json({ error: e.message });
      }

      if (!bulk) return res.status(201).json(out(Array.isArray(r.body) ? r.body[0] : r.body));
      return res.status(201).json({ added: fresh.length, skipped });
    }

    res.setHeader('Allow', 'GET,POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[/api/menu] Unexpected error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}