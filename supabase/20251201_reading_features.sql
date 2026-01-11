-- Supabase Reading Features Schema Migration
-- Run this in your Supabase SQL Editor to add reading progress, favorites, events, and reports

-- ============================================================================
-- Reading Progress v2 (enhanced version for Continue Reading shelf)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reading_progress_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_key TEXT NOT NULL,
  source TEXT DEFAULT 'unknown',
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  cover TEXT DEFAULT '',
  last_location TEXT DEFAULT '',
  progress NUMERIC DEFAULT 0,
  reader_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, book_key)
);

-- Indexes for reading_progress_v2
CREATE INDEX IF NOT EXISTS idx_reading_progress_v2_user_id ON reading_progress_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_v2_user_updated ON reading_progress_v2(user_id, updated_at DESC);

-- ============================================================================
-- Reading Favorites (heart button / favorites shelf)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reading_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_key TEXT NOT NULL,
  source TEXT DEFAULT 'unknown',
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  cover TEXT DEFAULT '',
  reader_url TEXT DEFAULT '',
  category TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, book_key)
);

-- Indexes for reading_favorites
CREATE INDEX IF NOT EXISTS idx_reading_favorites_user_id ON reading_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_favorites_user_created ON reading_favorites(user_id, created_at DESC);

-- ============================================================================
-- Reading Events (for trending and recommendations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reading_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- Can be UUID or 'anonymous'
  book_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('open', 'read_30s', 'complete')),
  title TEXT DEFAULT '',
  author TEXT DEFAULT '',
  cover TEXT DEFAULT '',
  source TEXT DEFAULT 'unknown',
  category TEXT DEFAULT '',
  reader_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for reading_events
CREATE INDEX IF NOT EXISTS idx_reading_events_created_at ON reading_events(created_at);
CREATE INDEX IF NOT EXISTS idx_reading_events_book_key ON reading_events(book_key);
CREATE INDEX IF NOT EXISTS idx_reading_events_type_created ON reading_events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_reading_events_category ON reading_events(category);

-- ============================================================================
-- Book Reports (broken book reports from users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS book_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- Can be UUID or 'anonymous'
  book_key TEXT NOT NULL,
  failed_url TEXT DEFAULT '',
  reason TEXT NOT NULL CHECK (reason IN ('no_readable_file', 'broken_link', 'access_denied', 'timeout', 'other')),
  details TEXT DEFAULT '',
  title TEXT DEFAULT '',
  author TEXT DEFAULT '',
  source TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'wont_fix')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Indexes for book_reports
CREATE INDEX IF NOT EXISTS idx_book_reports_status ON book_reports(status);
CREATE INDEX IF NOT EXISTS idx_book_reports_created_at ON book_reports(created_at);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on user-specific tables
ALTER TABLE reading_progress_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_favorites ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can only access their own data
CREATE POLICY reading_progress_v2_policy ON reading_progress_v2
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY reading_favorites_policy ON reading_favorites
  FOR ALL USING (auth.uid() = user_id);

-- Note: reading_events and book_reports don't need RLS since they're
-- accessed through server-side API with service role key, and some
-- entries are from anonymous users.

-- ============================================================================
-- Service Role Access (for server-side operations)
-- ============================================================================
-- The service role key bypasses RLS, so the server can:
-- - Insert events for anonymous users
-- - Query trending across all users
-- - Manage book reports

