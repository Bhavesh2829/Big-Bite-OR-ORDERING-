// GET   /api/orders/:id - customer tracks their own order.
//         :id is the long random public_token returned when the order was placed.
//         (The owner can also use the numeric order id, with the x-owner-key header.)
// PATCH /api/orders/:id - owner only: move an order forward
//   body { status: "preparing" | "served" | "cancelled" }
//   new        -> preparing | served | cancelled
//   preparing  -> served | cancelled
//   served / cancelled orders are final and cannot be changed.

import { configProblem, isOwner, sb, dbError, parseBody } from '../_lib.js';

const UUID    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d{1,18}$/;

const SELECT = 'id,public_token,order_no,status,total,note,created_at,tables(table_number),' +
               'order_items(item_name,size,extra_cheese,quantity,unit_price,line_total)';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method !== 'GET' && req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET,PATCH');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const problem = configProblem();
    if (problem) {
      console.error('[/api/orders/:id] Config error:', problem);
      return res.status(500).json({ error: 'Server is not configured', detail: problem });
    }

    const id = String((req.query && req.query.id) || '');
    const isToken = UUID.test(id);
    if (!isToken && !NUMERIC.test(id)) return res.status(400).json({ error: 'Invalid order id' });
    const column = isToken ? 'public_token' : 'id';

    /* ---------- GET: order tracking ---------- */
    if (req.method === 'GET') {
      // Numeric ids can be guessed, so they are for the owner only.
      if (!isToken && !isOwner(req)) return res.status(401).json({ error: 'Unauthorized' });

      const r = await sb('orders?' + new URLSearchParams({ [column]: 'eq.' + id, select: SELECT, limit: '1' }).toString());
      if (!r.ok) {
        console.error('[GET /api/orders/:id]', r.status, r.body);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!Array.isArray(r.body) || r.body.length === 0) return res.status(404).json({ error: 'Order not found' });

      const o = r.body[0];
      const table = o.tables ? o.tables.table_number : null;
      return res.status(200).json({
        id:        isToken ? o.public_token : o.id,
        orderNo:   o.order_no,  order_no: o.order_no,
        table,                  table_no: table,
        status:    o.status,
        total:     o.total,
        items:     (o.order_items || []).map(i => ({
          name: i.item_name, size: i.size, extraCheese: i.extra_cheese,
          qty: i.quantity, price: i.unit_price, lineTotal: i.line_total,
        })),
        note:      o.note,
        createdAt: o.created_at, created_at: o.created_at,
      });
    }

    /* ---------- PATCH: owner changes status ---------- */
    if (!isOwner(req)) return res.status(401).json({ error: 'Unauthorized' });

    const status = String(parseBody(req).status || '').toLowerCase();
    if (!['preparing', 'served', 'cancelled'].includes(status))
      return res.status(400).json({ error: 'status must be preparing, served or cancelled' });

    // Only open orders can change, and "preparing" can only come from "new".
    const from = status === 'preparing' ? 'new' : 'new,preparing';
    const qs = new URLSearchParams({
      [column]: 'eq.' + id,
      status:   `in.(${from})`,
      select:   'id,public_token,order_no,status,tables(table_number)',
    });

    const r = await sb('orders?' + qs.toString(), { method: 'PATCH', body: JSON.stringify({ status }) });
    if (!r.ok) {
      console.error('[PATCH /api/orders/:id]', r.status, r.body);
      return res.status(500).json({ error: dbError(r.body).message });
    }
    if (!Array.isArray(r.body) || r.body.length === 0)
      return res.status(409).json({ error: 'This order was already updated' });

    const o = r.body[0];
    return res.status(200).json({
      id: o.id, orderNo: o.order_no, table: o.tables ? o.tables.table_number : null, status: o.status,
    });
  } catch (e) {
    console.error('[/api/orders/:id] Unexpected error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}