// GET   /api/orders/:id  - public: a customer checks the status of their own order
//                          (the id is a long random uuid, so only the person who placed it knows it)
// PATCH /api/orders/:id  - owner only: move an order forward
//   body { status: "preparing" | "served" | "cancelled" }
//   new        -> preparing | served | cancelled
//   preparing  -> served | cancelled
//   served / cancelled orders are final and cannot be changed.

import { timingSafeEqual } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role key
const OWNER_KEY = process.env.OWNER_KEY;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configProblem(needOwnerKey) {
  if (!/^https?:\/\//.test(SUPABASE_URL))
    return "SUPABASE_URL is missing or invalid";
  if (!SUPABASE_KEY) return "SUPABASE_KEY is missing";
  if (needOwnerKey && !OWNER_KEY) return "OWNER_KEY is missing";
  return null;
}

function isOwner(req) {
  const given = req.headers["x-owner-key"];
  if (!OWNER_KEY || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(OWNER_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-owner-key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "GET" && req.method !== "PATCH") {
      res.setHeader("Allow", "GET,PATCH,OPTIONS");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const problem = configProblem(req.method === "PATCH");
    if (problem) {
      console.error("[/api/orders/:id] Config error:", problem);
      return res
        .status(500)
        .json({ error: "Server is not configured", detail: problem });
    }

    const id = String((req.query && req.query.id) || "");
    if (!UUID.test(id))
      return res.status(400).json({ error: "Invalid order id" });

    /* ---------- GET: customer order tracking ---------- */
    if (req.method === "GET") {
      const gr = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?${new URLSearchParams({ id: "eq." + id, limit: "1" }).toString()}`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        },
      );
      const gt = await gr.text();
      let gb = null;
      try {
        gb = gt ? JSON.parse(gt) : null;
      } catch (e) {
        gb = null;
      }
      if (!gr.ok) {
        console.error("[GET /api/orders/:id]", gr.status, gb);
        return res.status(500).json({ error: "Database error" });
      }
      if (!Array.isArray(gb) || gb.length === 0)
        return res.status(404).json({ error: "Order not found" });
      const o = gb[0];
      return res.status(200).json({
        id: o.id,
        orderNo: o.order_no,
        order_no: o.order_no,
        table: o.table_no,
        table_no: o.table_no,
        status: o.status,
        total: o.total,
        items: o.items,
        note: o.note,
        createdAt: o.created_at,
        created_at: o.created_at,
      });
    }

    /* ---------- PATCH: owner changes status ---------- */
    if (!isOwner(req)) return res.status(401).json({ error: "Unauthorized" });

    const status = String(parseBody(req).status || "").toLowerCase();
    if (!["preparing", "served", "cancelled"].includes(status))
      return res
        .status(400)
        .json({ error: "status must be preparing, served or cancelled" });

    // Only open orders can change, and "preparing" can only come from "new".
    const from = status === "preparing" ? "new" : "new,preparing";
    const qs = new URLSearchParams({ id: "eq." + id, status: `in.(${from})` });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?${qs.toString()}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status }),
    });
    const text = await r.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      body = text;
    }

    if (!r.ok) {
      console.error("[PATCH /api/orders/:id]", r.status, body);
      const b = Array.isArray(body) ? body[0] : body;
      return res
        .status(500)
        .json({ error: (b && b.message) || "Database error" });
    }
    if (!Array.isArray(body) || body.length === 0)
      return res.status(409).json({ error: "This order was already updated" });

    const o = body[0];
    return res
      .status(200)
      .json({
        id: o.id,
        orderNo: o.order_no,
        table: o.table_no,
        status: o.status,
      });
  } catch (e) {
    console.error("[/api/orders/:id] Unexpected error:", e);
    return res.status(500).json({ error: "Server error", detail: e.message });
  }
}
