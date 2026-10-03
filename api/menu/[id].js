const { db, ownerOnly } = require('../_lib');
const ALLOWED = ['new', 'preparing', 'ready', 'served', 'cancelled'];

module.exports = async (req, res) => {
  try {
    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: 'Bad id' });

    // Customer page checks status (only shows safe info)
    if (req.method === 'GET') {
      const { data } = await db.from('orders').select('id,order_no,total,status').eq('id', id).maybeSingle();
      if (!data) return res.status(404).json({ error: 'Not found' });
      return res.json({ id: data.id, orderNo: data.order_no, total: Number(data.total), status: data.status });
    }

    // Owner changes status (accept = preparing, decline = cancelled)
    if (req.method === 'PATCH') {
      if (!ownerOnly(req, res)) return;
      const status = req.body && req.body.status;
      if (!ALLOWED.includes(status)) return res.status(400).json({ error: 'Bad status' });
      const { error } = await db.from('orders').update({ status }).eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
};