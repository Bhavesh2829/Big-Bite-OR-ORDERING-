const { db, ownerOnly } = require('../_lib');

const shape = (o) => ({ id: o.id, orderNo: o.order_no, total: Number(o.total), status: o.status });

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') return await createOrder(req, res); // customer
    if (req.method === 'GET') return await listOrders(req, res);   // owner
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
};

async function createOrder(req, res) {
  const { table, sig, idempotencyKey, note, items } = req.body || {};
  const tableNo = parseInt(table, 10);
  if (!tableNo || !Array.isArray(items) || !items.length || items.length > 50)
    return res.status(400).json({ error: 'Bad order' });

  // 1. check table + QR signature
  const { data: t } = await db.from('tables')
    .select('id,qr_signature,is_active').eq('table_number', tableNo).maybeSingle();
  if (!t || !t.is_active || !sig || sig !== t.qr_signature)
    return res.status(403).json({ error: 'Invalid QR code' });

  // 2. duplicate protection
  if (idempotencyKey) {
    const { data: old } = await db.from('orders')
      .select('id,order_no,total,status').eq('idempotency_key', String(idempotencyKey)).maybeSingle();
    if (old) return res.json(shape(old));
  }

  // 3. prices come from DATABASE, not from the browser
  const names = [...new Set(items.map((i) => String(i.name)))];
  const { data: menu } = await db.from('menu_items')
    .select('id,name,price').in('name', names).eq('is_available', true);
  const byName = Object.fromEntries((menu || []).map((m) => [m.name, m]));

  let total = 0;
  const rows = [];
  for (const i of items) {
    const m = byName[String(i.name)];
    const qty = Math.min(parseInt(i.qty, 10) || 0, 20);
    if (!m || qty < 1) return res.status(400).json({ error: 'Item not available: ' + i.name });
    const line = Number(m.price) * qty;
    total += line;
    rows.push({
      menu_item_id: m.id, item_name: m.name, size: i.size || null,
      extra_cheese: !!i.extraCheese, quantity: qty, unit_price: m.price, line_total: line,
    });
  }

  // 4. save
  const { data: order, error } = await db.from('orders').insert({
    table_id: t.id,
    note: String(note || '').slice(0, 200),
    idempotency_key: idempotencyKey ? String(idempotencyKey) : null,
    total,
  }).select('id,order_no,total,status').single();
  if (error) throw error;

  const { error: e2 } = await db.from('order_items').insert(rows.map((r) => ({ ...r, order_id: order.id })));
  if (e2) { await db.from('orders').delete().eq('id', order.id); throw e2; }

  res.status(201).json(shape(order));
}

// Owner: new orders waiting for Accept / Decline
async function listOrders(req, res) {
  if (!ownerOnly(req, res)) return;
  const { data, error } = await db.from('orders')
    .select('id,order_no,status,total,note,created_at,tables(table_number),order_items(item_name,size,extra_cheese,quantity,line_total,menu_items(is_veg))')
    .eq('status', 'new').order('created_at', { ascending: true });
  if (error) throw error;
  res.json(data.map((o) => ({
    id: o.id, orderNo: o.order_no, table: o.tables && o.tables.table_number,
    status: o.status, total: Number(o.total), note: o.note, createdAt: o.created_at,
    items: o.order_items.map((i) => ({
      name: i.item_name, size: i.size, extraCheese: i.extra_cheese, qty: i.quantity, price: Number(i.line_total),
      veg: i.menu_items ? i.menu_items.is_veg : null,
    })),
  })));
}