// GET /api/stats - dashboard numbers (owner only)

import { timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;   // service_role key
const OWNER_KEY    = process.env.OWNER_KEY;

const DAY_MS        = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;      // India has no daylight saving
const WEEKDAYS      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PAGE          = 1000;

function isOwner(req) {
  const given = req.headers['x-owner-key'];
  if (!OWNER_KEY || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(OWNER_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// UTC timestamp (ms) of 00:00 IST for the day that contains `ms`.
function istMidnight(ms) {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) {
    const msg = (body && body.message) || `Supabase returned ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// Reads every matching row, 1000 at a time (Supabase caps one response at 1000).
async function fetchAll(params) {
  const rows = [];
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ ...params, order: 'created_at.asc,id.asc', limit: String(PAGE), offset: String(page * PAGE) });
    const batch = await sb('orders?' + qs.toString());
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

function itemsOf(order) {
  let items = order.items;
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
  return Array.isArray(items) ? items : [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!/^https?:\/\//.test(SUPABASE_URL) || !SUPABASE_KEY || !OWNER_KEY) {
    console.error('[/api/stats] Missing SUPABASE_URL, SUPABASE_KEY or OWNER_KEY');
    return res.status(500).json({ error: 'Server is not configured' });
  }
  if (!isOwner(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const todayStart = istMidnight(Date.now());
    const chartFrom  = todayStart - 5 * DAY_MS;    // 6 days: today + 5 before
    const weekFrom   = todayStart - 6 * DAY_MS;    // 7 days: today + 6 before

    const [served, active] = await Promise.all([
      fetchAll({ status: 'eq.served', created_at: 'gte.' + new Date(weekFrom).toISOString(), select: 'id,total,items,created_at' }),
      sb('orders?' + new URLSearchParams({ status: 'in.(new,preparing,ready)', select: 'id', limit: String(PAGE) }).toString()),
    ]);

    let todaySales = 0, completedOrders = 0, itemsServed = 0;
    const values  = [0, 0, 0, 0, 0, 0];
    const itemMap = new Map();

    for (const o of served) {
      const t = new Date(o.created_at).getTime();
      if (Number.isNaN(t)) continue;
      const total = Number(o.total) || 0;
      const items = itemsOf(o);

      const idx = Math.floor((t - chartFrom) / DAY_MS);
      if (idx >= 0 && idx < 6) values[idx] += total;

      if (t >= todayStart) {
        todaySales += total;
        completedOrders += 1;
        itemsServed += items.reduce((s, i) => s + (Number(i.qty ?? i.quantity ?? 1) || 1), 0);
      }

      for (const i of items) {
        const name = i.name || i.base || 'Unknown';
        const qty  = Number(i.qty ?? i.quantity ?? 1) || 1;
        const row  = itemMap.get(name) || { name, revenue: 0, qty: 0 };
        row.revenue += (Number(i.price) || 0) * qty;
        row.qty     += qty;
        itemMap.set(name, row);
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