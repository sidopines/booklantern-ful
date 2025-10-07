// supabaseAdmin.js
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // <-- exact name

if (!url || !key) {
  console.warn('[supabaseAdmin] Missing config', {
    hasUrl: Boolean(url),
    hasKey: Boolean(key),
  });
  module.exports = null;
} else {
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log(
    `[supabaseAdmin] Ready (url ok, key length ${String(key).length})`
  );
  module.exports = supabase;
}
