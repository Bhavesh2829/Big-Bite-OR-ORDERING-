import { timingSafeEqual } from 'node:crypto';

// Server environment variables
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;   // service_role key
const OWNER_KEY    = process.env.OWNER_KEY;

function configProblem() {
  if (!/^https?:\/\//.test(SUPABASE_URL)) return 'SUPABASE_URL is missing or invalid';
  if (!SUPABASE_KEY) return 'SUPABASE_KEY is missing';
  if (!OWNER_KEY)    return 'OWNER_KEY is missing';
  return null;
}

function isOwner(req) {
  const given = req.headers['x-owner-key'];
  if (!OWNER_KEY || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(OWNER_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Supabase Fetch Helper
async function sb(path, opt = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opt,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
      ...(opt.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: res.ok, status: res.status, body };
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { 
    try { return JSON.parse(req.body); } catch (e) { return {}; } 
  }
  return {};
}

function dbMessage(body) {
  const b = Array.isArray(body) ? body[0] : body;
  return (b && b.message) || (typeof body === 'string' && body.slice(0, 200)) || 'Database error';
}

export default async function handler(req, res) {
  // CORS Configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-owner-key');
  res.setHeader('Cache-Control', 'no-store');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Extract the dish ID from the URL (e.g., /api/menu/94)
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing dish ID in request' });

  try {
    const problem = configProblem();
    if (problem) {
      console.error('[/api/menu/[id]] Config error:', problem);
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    // Secure the route
    if (!isOwner(req)) return res.status(401).json({ error: 'Unauthorized access' });

    // Target the correct Supabase table
    const tableName = 'menu_items';

    /* ---------- PATCH (Edit/Update Dish) ---------- */
    if (req.method === 'PATCH') {
      const raw = parseBody(req);
      const updates = {};
      
      // Map payload to database columns securely
      if (raw.name !== undefined) {
        updates.name = String(raw.name).trim();
        if (!updates.name || updates.name.length > 80) return res.status(400).json({ error: 'Dish name must be 1-80 characters' });
      }
      if (raw.category !== undefined) {
        updates.category = String(raw.category).trim();
        if (!updates.category || updates.category.length > 60) return res.status(400).json({ error: 'Category is required (max 60 chars)' });
      }
      if (raw.price !== undefined) {
        updates.price = Number(raw.price);
        if (!Number.isInteger(updates.price) || updates.price < 0) return res.status(400).json({ error: 'Price must be a valid whole number' });
      }
      
      // Handle booleans mapping to is_veg and is_available
      if (raw.isVeg !== undefined) updates.is_veg = Boolean(raw.isVeg);
      if (raw.is_veg !== undefined) updates.is_veg = Boolean(raw.is_veg);
      
      if (raw.available !== undefined) updates.is_available = Boolean(raw.available);
      if (raw.is_available !== undefined) updates.is_available = Boolean(raw.is_available);

      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided to update' });

      // Execute update query: UPDATE menu_items SET ... WHERE id = req.query.id
      const r = await sb(`${tableName}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });

      if (!r.ok) {
        console.error('[PATCH /api/menu/[id]] Error:', r.status, r.body);
        return res.status(500).json({ error: dbMessage(r.body) });
      }
      return res.status(200).json(Array.isArray(r.body) ? r.body[0] : r.body);
    }

    /* ---------- DELETE (Remove Dish) ---------- */
    if (req.method === 'DELETE') {
      // Execute delete query: DELETE FROM menu_items WHERE id = req.query.id
      const r = await sb(`${tableName}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });

      if (!r.ok) {
        console.error('[DELETE /api/menu/[id]] Error:', r.status, r.body);
        return res.status(500).json({ error: dbMessage(r.body) });
      }
      return res.status(200).json({ success: true, deleted_id: id });
    }

    // Reject any other methods
    res.setHeader('Allow', 'PATCH,DELETE,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('[/api/menu/[id]] Unexpected error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}