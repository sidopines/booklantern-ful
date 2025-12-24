-- =============================================================================
-- BookLantern Local Catalog Schema
-- =============================================================================
-- 
-- HOW TO APPLY:
-- 1. Go to your Supabase dashboard: https://supabase.com/dashboard
-- 2. Select your project
-- 3. Navigate to SQL Editor (left sidebar)
-- 4. Paste this entire file contents
-- 5. Click "Run" to execute
--
-- This creates:
-- - catalog_books table for storing harvested book metadata
-- - Full-text search index for fast queries
-- - Unique constraint on (source, source_id) for upserts
--
-- =============================================================================

-- Drop existing table if re-running (comment out in production)
-- DROP TABLE IF EXISTS catalog_books;

CREATE TABLE IF NOT EXISTS catalog_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source identification
  source text NOT NULL,                           -- e.g. 'doab', 'loc', 'gutenberg'
  source_id text NOT NULL,                        -- OAI identifier or stable external id
  
  -- Book metadata
  title text,
  authors text,                                   -- Simple joined string for now
  language text,
  published_year int,
  subjects text,                                  -- Comma-separated or semicolon-separated
  description text,
  
  -- Access info
  source_url text,                                -- Landing page URL
  open_access boolean DEFAULT true,
  
  -- Timestamps
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  
  -- Full-text search vector (auto-generated)
  search_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', 
      coalesce(title, '') || ' ' || 
      coalesce(authors, '') || ' ' || 
      coalesce(subjects, '')
    )
  ) STORED,
  
  -- Ensure no duplicate records from same source
  UNIQUE(source, source_id)
);

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_catalog_books_search_tsv 
  ON catalog_books USING gin(search_tsv);

-- Create index on source for filtering by provider
CREATE INDEX IF NOT EXISTS idx_catalog_books_source 
  ON catalog_books(source);

-- Create index on language for filtering
CREATE INDEX IF NOT EXISTS idx_catalog_books_language 
  ON catalog_books(language);

-- Create index on open_access for filtering
CREATE INDEX IF NOT EXISTS idx_catalog_books_open_access 
  ON catalog_books(open_access);

-- =============================================================================
-- RPC Function for Full-Text Search (used by /api/catalog/search)
-- =============================================================================

CREATE OR REPLACE FUNCTION catalog_search(
  search_query text,
  result_limit int DEFAULT 25
)
RETURNS SETOF catalog_books
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM catalog_books
  WHERE search_tsv @@ websearch_to_tsquery('simple', search_query)
    AND open_access = true
  ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', search_query)) DESC
  LIMIT result_limit;
$$;

-- =============================================================================
-- Example Queries (for reference):
-- =============================================================================
--
-- Full-text search:
--   SELECT * FROM catalog_books 
--   WHERE search_tsv @@ websearch_to_tsquery('simple', 'history philosophy')
--   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', 'history philosophy')) DESC
--   LIMIT 25;
--
-- Upsert pattern (used by harvester):
--   INSERT INTO catalog_books (source, source_id, title, authors, ...)
--   VALUES ('doab', 'oai:directory.doabooks.org:12345', 'Book Title', 'Author Name', ...)
--   ON CONFLICT (source, source_id) DO UPDATE SET
--     title = EXCLUDED.title,
--     authors = EXCLUDED.authors,
--     updated_at = now();
--
-- Using the RPC function:
--   SELECT * FROM catalog_search('history philosophy', 25);
--
-- =============================================================================
