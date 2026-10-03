const { db, ownerOnly } = require('../_lib');

module.exports = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;
    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: 'Bad id' });

    if (req.method === 'DELETE') {
      const { error } = await db.from('menu_items').delete().eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }
    if (req.method === 'PATCH') {
      const b = req.body || {};
      const patch = {};
      if (b.name !== undefined) patch.name = String(b.name).trim();
      if (b.price !== undefined) patch.price = Number(b.price);
      if (b.category !== undefined) patch.category = b.category;
      if (b.isVeg !== undefined) patch.is_veg = !!b.isVeg;
      if (b.isAvailable !== undefined) patch.is_available = !!b.isAvailable;
      const { error } = await db.from('menu_items').update(patch).eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
};