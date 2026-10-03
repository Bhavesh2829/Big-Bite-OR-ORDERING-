const { db, ownerOnly } = require('./_lib');

const IST = 330 * 60000; // India time (UTC+5:30)
// start of day in IST, "n" days ago, returned as a real Date
function dayStart(n) {
  const d = new Date(Date.now() + IST);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - IST - n * 86400000);
}

module.exports = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;

    const { data, error } = await db.from('orders')
      .select('total,status,created_at,order_items(item_name,quantity,line_total)')
      .gte('created_at', dayStart(6).toISOString());
    if (error) throw error;

    const { count: activeOrders } = await db.from('orders')
      .select('id', { count: 'exact', head: true }).in('status', ['new', 'preparing']);

    const todayStart = dayStart(0).getTime();
    let todaySales = 0, itemsServed = 0, completedOrders = 0;
    const days = [0, 1, 2, 3, 4, 5].map((n) => dayStart(5 - n)); // oldest -> today
    const values = days.map(() => 0);
    const sellers = {};

    for (const o of data) {
      if (o.status === 'cancelled') continue;
      const t = new Date(o.created_at).getTime();
      const total = Number(o.total);
      if (t >= todayStart) {
        todaySales += total;
        if (o.status === 'served') {
          completedOrders++;
          itemsServed += o.order_items.reduce((s, i) => s + i.quantity, 0);
        }
      }
      days.forEach((d, idx) => {
        if (t >= d.getTime() && t < d.getTime() + 86400000) values[idx] += total;
      });
      for (const i of o.order_items) {
        sellers[i.item_name] = (sellers[i.item_name] || 0) + Number(i.line_total);
      }
    }

    const labels = days.map((d) =>
      new Date(d.getTime() + IST).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }));
    const topSellers = Object.entries(sellers)
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    res.json({ activeOrders, todaySales, itemsServed, completedOrders, revenue: { labels, values }, topSellers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
};