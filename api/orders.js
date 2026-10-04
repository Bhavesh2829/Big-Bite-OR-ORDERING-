import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const auth = req => req.headers['x-owner-key'] === process.env.OWNER_KEY;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { data } = await db.from('orders').select('*')
      .in('status', ['new']).order('created_at', { ascending: false });
    return res.json(data || []);
  }
  if (req.method === 'POST') {
    const { table, items, note, idempotencyKey } = req.body;
    const total = items.reduce((s, i) => s + i.qty * (i.price || 0), 0);
    const { data, error } = await db.from('orders')
      .insert({ table_no: table, items, note, total })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ id: data.id, orderNo: data.order_no, total: data.total, status: data.status });
  }
}