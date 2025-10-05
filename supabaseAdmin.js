// supabaseAdmin.js
// Minimal server-side Supabase client for routes that need admin/service access.

const { createClient } = require('@supabase/supabase-js');

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-side only

if (!url || !key) {
  // Don’t throw: app can still run without admin features. Just log.
  console.warn('[supabaseAdmin] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

// Export a client; if envs are missing it’ll still be defined but requests will error cleanly.
const supabaseAdmin = createClient(url || 'https://example.supabase.co', key || 'invalid-key');

module.exports = supabaseAdmin;
