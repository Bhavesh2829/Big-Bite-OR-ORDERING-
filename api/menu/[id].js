// PATCH  /api/menu/:id - owner only: edit name/price/category/isVeg and/or available
// DELETE /api/menu/:id - owner only: remove dish from the menu
//   Delete is "soft": the row is hidden (is_deleted = true) so old orders that
//   used this dish keep working. Hard delete would fail on order_items.

import { configProblem, isOwner, sb, dbError, parseBody } from '../_lib.js';

const SELECT = 'id,name,category,price,is_veg,is_available';

const out = r => ({
  id:        r.id,
  name:      r.name,
  category:  r.category,
  price:     Number(r.price),
  is_veg:    r.is_veg === true,
  available: r.is_available !== false,
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const problem = configProblem();
    if (problem) {
      console.error('[/api/menu/:id] Config error:', problem);
      return res.status(500).json({ error: 'Server is not configured', detail: problem });
    }
    if (!isOwner(req)) return res.status(401).json({ error: 'Unauthorized' });

    const id = String(req.query.id || '');
    if (!/^\d{1,18}$/.test(id)) return res.status(400).json({ error: 'Invalid dish id' });

    const target = `menu_items?id=eq.${id}&is_deleted=eq.false`;

    /* ---------- PATCH ---------- */
    if (req.method === 'PATCH') {
      const b = parseBody(req);
      const upd = {};

      if (b.name !== undefined) {
        const name = String(b.name).trim();
        if (!name || name.length > 80) return res.status(400).json({ error: 'Dish name is required (max 80 characters)' });
        upd.name = name;
      }
      if (b.category !== undefined) {
        const category = String(b.category).trim();
        if (!category || category.length > 60) return res.status(400).json({ error: 'Category is required' });
        upd.category = category;
      }
      if (b.price !== undefined) {
        const price = Number(b.price);
        if (!Number.isInteger(price) || price < 0 || price > 100000)
          return res.status(400).json({ error: 'Price must be a whole number of rupees' });
        upd.price = price;
      }
      if (b.isVeg !== undefined || b.is_veg !== undefined) upd.is_veg = (b.isVeg ?? b.is_veg) === true;
      if (b.available !== undefined)                       upd.is_available = b.available === true;

      if (Object.keys(upd).length === 0) return res.status(400).json({ error: 'Nothing to update' });

      // Renaming: block a name that another dish already uses.
      if (upd.name) {
        const all = await sb('menu_items?' + new URLSearchParams({
          select: 'id,name', is_deleted: 'eq.false', limit: '2000',
        }).toString());
        if (!all.ok) {
          console.error('[PATCH /api/menu/:id] lookup', all.status, all.body);
          return res.status(500).json({ error: dbError(all.body).message });
        }
        const clash = (all.body || []).some(m => String(m.id) !== id && String(m.name).trim().toLowerCase() === upd.name.toLowerCase());
        if (clash) return res.status(409).json({ error: 'Another dish already has this name' });
      }

      const r = await sb(target + '&select=' + SELECT, { method: 'PATCH', body: JSON.stringify(upd) });
      if (!r.ok) {
        console.error('[PATCH /api/menu/:id]', r.status, r.body);
        const e = dbError(r.body);
        if (e.code === '23505') return res.status(409).json({ error: 'Another dish already has this name' });
        return res.status(500).json({ error: e.message });
      }
      if (!Array.isArray(r.body) || r.body.length === 0) return res.status(404).json({ error: 'Dish not found' });
      return res.status(200).json(out(r.body[0]));
    }

    /* ---------- DELETE (soft) ---------- */
    if (req.method === 'DELETE') {
      const r = await sb(target + '&select=id', {
        method: 'PATCH',
        body: JSON.stringify({ is_deleted: true, is_available: false }),
      });
      if (!r.ok) {
        console.error('[DELETE /api/menu/:id]', r.status, r.body);
        return res.status(500).json({ error: dbError(r.body).message });
      }
      if (!Array.isArray(r.body) || r.body.length === 0) return res.status(404).json({ error: 'Dish not found' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'PATCH,DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[/api/menu/:id] Unexpected error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}