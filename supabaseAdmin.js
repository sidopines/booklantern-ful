// supabaseAdmin.js
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabaseAdmin] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  module.exports = null;
} else {
  module.exports = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'booklantern-server' } }
  });
}
