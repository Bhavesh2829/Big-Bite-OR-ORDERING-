import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const auth = req => req.headers['x-owner-key'] === process.env.OWNER_KEY;

export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method === 'GET') {
    const { data } = await db.from('orders').select('*').eq('id', id).single();
    return data ? res.json(data) : res.status(404).json({ error: 'Not found' });
  }
  if (req.method === 'PATCH') {
    if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { status } = req.body;
    const { data } = await db.from('orders').update({ status }).eq('id', id).select().single();
    return res.json({ ok: true, ...data });
  }
}