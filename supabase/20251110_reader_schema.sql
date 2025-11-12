-- Supabase Reader Schema Migration
-- Run this in your Supabase SQL Editor once before deploying

-- Saved books table
CREATE TABLE IF NOT EXISTS saved_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  cover_url TEXT,
  provider TEXT,
  provider_id TEXT,
  format TEXT DEFAULT 'epub',
  direct_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, book_id)
);

-- Reading progress table
CREATE TABLE IF NOT EXISTS reading_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  cfi TEXT NOT NULL,
  progress_percent NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, book_id)
);

-- Bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  cfi TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Highlights table
CREATE TABLE IF NOT EXISTS highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  cfi TEXT NOT NULL,
  text TEXT,
  color TEXT DEFAULT 'yellow',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reader settings table
CREATE TABLE IF NOT EXISTS reader_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  font_size INTEGER DEFAULT 100,
  theme TEXT DEFAULT 'dark',
  font_family TEXT DEFAULT 'serif',
  line_height NUMERIC DEFAULT 1.5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_saved_books_user_id ON saved_books(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_user_id ON reading_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_reader_settings_user_id ON reader_settings(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE saved_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE reader_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only access their own data)
CREATE POLICY saved_books_policy ON saved_books
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY reading_progress_policy ON reading_progress
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY bookmarks_policy ON bookmarks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY highlights_policy ON highlights
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY reader_settings_policy ON reader_settings
  FOR ALL USING (auth.uid() = user_id);
