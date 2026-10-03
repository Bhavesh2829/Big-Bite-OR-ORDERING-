const { createClient } = require('@supabase/supabase-js');

// Server-only client (uses the secret service key, never put this key in HTML)
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Owner private-link check: dashboard sends the secret key in a header
function ownerOnly(req, res) {
  const key = req.headers['x-owner-key'];
  if (process.env.OWNER_KEY && key === process.env.OWNER_KEY) return true;
  res.status(401).json({ error: 'Not allowed' });
  return false;
}

module.exports = { db, ownerOnly };