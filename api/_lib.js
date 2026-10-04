// Shared helpers. Files starting with "_" are not public API routes on Vercel.
import { timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;   // service_role key (server only)
const OWNER_KEY    = process.env.OWNER_KEY;

export function configProblem() {
  if (!/^https?:\/\//.test(SUPABASE_URL)) return 'SUPABASE_URL is missing or invalid';
  if (!SUPABASE_KEY) return 'SUPABASE_KEY is missing';
  if (!OWNER_KEY)    return 'OWNER_KEY is missing';
  return null;
}

export function isOwner(req) {
  const given = req.headers['x-owner-key'];
  if (!OWNER_KEY || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(OWNER_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sb(path, opt = {}) {
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

export function dbError(body) {
  const b = Array.isArray(body) ? body[0] : body;
  return {
    message: (b && b.message) || (typeof body === 'string' && body.slice(0, 200)) || 'Database error',
    code:    (b && b.code) || null,
  };
}

export function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}