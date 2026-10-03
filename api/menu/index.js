const { db, ownerOnly } = require('../_lib');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { data, error } = await db.from('menu_items')
        .select('id,name,category,price,is_veg,is_available').order('category').order('name');
      if (error) throw error;
      return res.json(data.map((m) => ({ ...m, price: Number(m.price) })));
    }
    if (req.method === 'POST') {
      if (!ownerOnly(req, res)) return;
      const { name, price, category, isVeg } = req.body || {};
      if (!name || !(Number(price) > 0)) return res.status(400).json({ error: 'Name and price needed' });
      const { data, error } = await db.from('menu_items')
        .insert({ name: String(name).trim(), price: Number(price), category: category || 'Main Course', is_veg: !!isVeg })
        .select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
};
