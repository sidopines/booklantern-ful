// lib/supabaseServer.js
// Server-side Supabase client for catalog operations
// Uses service role key for full database access

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.supabaseUrl;
const SUPABASE_SERVICE_ROLE_KEY = 
  process.env.SUPABASE_SERVICE_ROLE_KEY || 
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.supabaseKey;

// Fail fast if env vars are missing
if (!SUPABASE_URL) {
  console.error('[supabaseServer] FATAL: SUPABASE_URL is not set');
  console.error('[supabaseServer] Set SUPABASE_URL in your .env file');
  throw new Error('Missing SUPABASE_URL environment variable');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[supabaseServer] FATAL: SUPABASE_SERVICE_ROLE_KEY is not set');
  console.error('[supabaseServer] Set SUPABASE_SERVICE_ROLE_KEY in your .env file');
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

// Create singleton client
const supabaseServer = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

console.log(`[supabaseServer] Initialized (url: ${SUPABASE_URL.substring(0, 30)}...)`);

module.exports = supabaseServer;
