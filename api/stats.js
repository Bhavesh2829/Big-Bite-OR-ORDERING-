// GET /api/stats  — dashboard stats (owner only)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OWNER_KEY    = process.env.OWNER_KEY;

const db = (path) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  }).then(r => r.json());

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.headers['x-owner-key'] !== OWNER_KEY) return res.status(401).json({ error: 'Unauthorized' });

  // Today's date range (IST = UTC+5:30)
  const now   = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  // Fetch all today's completed orders + active orders
  const [allToday, active] = await Promise.all([
    db(`orders?created_at=gte.${todayISO}&status=in.("served")&select=total,items`),
    db(`orders?status=in.("new","preparing","ready")&select=id`),
  ]);

  const todaySales      = Array.isArray(allToday) ? allToday.reduce((s, o) => s + (o.total || 0), 0) : 0;
  const completedOrders = Array.isArray(allToday) ? allToday.length : 0;
  const itemsServed     = Array.isArray(allToday)
    ? allToday.reduce((s, o) => s + (Array.isArray(o.items) ? o.items.reduce((a, i) => a + (i.qty || 1), 0) : 0), 0)
    : 0;
  const activeOrders = Array.isArray(active) ? active.length : 0;

  // 6-day revenue chart (last 6 days)
  const labels = [], values = [];
  for (let d = 5; d >= 0; d--) {
    const day   = new Date(now);
    day.setDate(day.getDate() - d);
    day.setHours(0, 0, 0, 0);
    const next  = new Date(day);
    next.setDate(next.getDate() + 1);
    const rows  = await db(`orders?created_at=gte.${day.toISOString()}&created_at=lt.${next.toISOString()}&status=eq.served&select=total`);
    labels.push(day.toLocaleDateString('en-IN', { weekday: 'short' }));
    values.push(Array.isArray(rows) ? rows.reduce((s, o) => s + (o.total || 0), 0) : 0);
  }

  // Top sellers this week
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekOrders = await db(`orders?created_at=gte.${weekStart.toISOString()}&status=eq.served&select=items`);

  const itemMap = {};
  if (Array.isArray(weekOrders)) {
    weekOrders.forEach(o => {
      if (!Array.isArray(o.items)) return;
      o.items.forEach(i => {
        const k = i.name || i.base || 'Unknown';
        if (!itemMap[k]) itemMap[k] = { name: k, revenue: 0, qty: 0 };
        itemMap[k].revenue += (i.price || 0) * (i.qty || 1);
        itemMap[k].qty     += (i.qty || 1);
      });
    });
  }
  const topSellers = Object.values(itemMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return res.json({
    todaySales, activeOrders, itemsServed, completedOrders,
    revenue: { labels, values },
    topSellers,
  });
}
