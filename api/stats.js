// GET /api/stats - dashboard numbers (owner only)
// Tables: orders (status, total, created_at) + order_items (item_name, quantity, unit_price, line_total)

import { configProblem, isOwner, sb } from './_lib.js';

const DAY_MS        = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;      // India has no daylight saving
const WEEKDAYS      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PAGE          = 1000;

// UTC timestamp (ms) of 00:00 IST for the day that contains `ms`.
const istMidnight = ms => Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;

async function get(path) {
  const r = await sb(path);
  if (!r.ok || !Array.isArray(r.body)) {
    const msg = (r.body && r.body.message) || `Supabase returned ${r.status}`;
    throw new Error(msg);
  }
  return r.body;
}

// Reads every matching row, 1000 at a time (Supabase caps one response at 1000).
async function fetchAll(params) {
  const rows = [];
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ ...params, order: 'created_at.asc,id.asc', limit: String(PAGE), offset: String(page * PAGE) });
    const batch = await get('orders?' + qs.toString());
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const problem = configProblem();
  if (problem) {
    console.error('[/api/stats] Config error:', problem);
    return res.status(500).json({ error: 'Server is not configured', detail: problem });
  }
  if (!isOwner(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const todayStart = istMidnight(Date.now());
    const chartFrom  = todayStart - 5 * DAY_MS;    // 6 days: today + 5 before
    const weekFrom   = todayStart - 6 * DAY_MS;    // 7 days: today + 6 before

    const [served, active] = await Promise.all([
      fetchAll({
        status:     'eq.served',
        created_at: 'gte.' + new Date(weekFrom).toISOString(),
        select:     'id,total,created_at,order_items(item_name,quantity,unit_price,line_total)',
      }),
      get('orders?' + new URLSearchParams({ status: 'in.(new,preparing,ready)', select: 'id', limit: String(PAGE) }).toString()),
    ]);

    let todaySales = 0, completedOrders = 0, itemsServed = 0;
    const values  = [0, 0, 0, 0, 0, 0];
    const itemMap = new Map();

    for (const o of served) {
      const t = new Date(o.created_at).getTime();
      if (Number.isNaN(t)) continue;

      const items = (o.order_items || []).map(i => ({
        name:  i.item_name || 'Unknown',
        qty:   Number(i.quantity) || 1,
        price: Number(i.unit_price) || 0,
        line:  Number(i.line_total) || (Number(i.unit_price) || 0) * (Number(i.quantity) || 1),
      }));
      const total = Number(o.total) || items.reduce((s, i) => s + i.line, 0);

      const idx = Math.floor((t - chartFrom) / DAY_MS);
      if (idx >= 0 && idx < 6) values[idx] += total;

      if (t >= todayStart) {
        todaySales += total;
        completedOrders += 1;
        itemsServed += items.reduce((s, i) => s + i.qty, 0);
      }

      for (const i of items) {
        const row = itemMap.get(i.name) || { name: i.name, revenue: 0, qty: 0 };
        row.revenue += i.line;
        row.qty     += i.qty;
        itemMap.set(i.name, row);
      }
    }

    const labels = values.map((_, n) => WEEKDAYS[new Date(chartFrom + n * DAY_MS + IST_OFFSET_MS).getUTCDay()]);
    const round  = n => Math.round(n * 100) / 100;

    const topSellers = [...itemMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(t => ({ ...t, revenue: round(t.revenue) }));

    return res.status(200).json({
      todaySales:      round(todaySales),
      activeOrders:    active.length,
      itemsServed,
      completedOrders,
      revenue:         { labels, values: values.map(round) },
      topSellers,
    });
  } catch (e) {
    console.error('[GET /api/stats] Error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}