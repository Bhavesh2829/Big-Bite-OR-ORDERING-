// GET /api/public-menu  - public (no owner key). Used by the customer QR page (index.html)
// Returns only dishes that are available. Reads the SAME "menu" table the dashboard edits.

const SUPABASE_URL = (process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store"); // always fresh prices
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  if (!/^https?:\/\//.test(SUPABASE_URL) || !SUPABASE_KEY)
    return res.status(500).json({ error: "Server is not configured" });

  try {
    const qs = new URLSearchParams({
      select: "id,name,category,price,is_veg,available",
      order: "id.asc",
      limit: "1000",
    });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/menu?${qs}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!r.ok) {
      console.error("[GET /api/public-menu]", r.status, await r.text());
      return res.status(500).json({ error: "Could not load menu" });
    }
    const rows = await r.json();
    const list = (Array.isArray(rows) ? rows : [])
      .filter((m) => m.available !== false)
      .map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        price: Number(m.price) || 0,
        is_veg: m.is_veg === true,
      }));
    return res.status(200).json(list);
  } catch (e) {
    console.error("[/api/public-menu]", e);
    return res.status(500).json({ error: "Server error" });
  }
}
