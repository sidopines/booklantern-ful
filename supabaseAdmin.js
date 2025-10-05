// supabaseAdmin.js
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Export a real client only if both values exist; otherwise export null
let client = null;
if (!url || !key) {
  console.warn('[supabaseAdmin] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
} else {
  client = createClient(url, key, {
    auth: { persistSession: false }
  });
}

module.exports = client; // may be null (by design)
