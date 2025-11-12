# Reader Notes

## Database Setup

Before deploying the reader feature, you must run the SQL migration in Supabase:

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of `supabase/20251110_reader_schema.sql`
4. Click "Run" to execute the migration

This will create the following tables:
- `saved_books` - User's saved library
- `reading_progress` - Reading position for each book
- `bookmarks` - User bookmarks with CFI locations
- `highlights` - User highlights and annotations
- `reader_settings` - Per-user reader preferences (theme, font, etc.)

All tables include Row Level Security (RLS) policies to ensure users can only access their own data.

## Environment Variables

The reader requires the following environment variable:

```bash
APP_SIGNING_SECRET=<your-secret-here>
```

Generate a secure random secret (at least 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Add this to your `.env` file or environment configuration.

## Architecture

### Federated Search
- Sources: Gutenberg (Gutendex), Open Library, Internet Archive, Library of Congress
- Parallel API calls with 3.5s timeout per source
- Results deduplicated by title+author, preferring EPUB over PDF
- 10-minute LRU cache for search results
- Signed tokens (1hr TTL) prevent direct URL exposure

### Reader Security
- All reader routes require authentication via `ensureSubscriber` middleware
- Book files proxied through `/proxy/epub?token=...` - never exposed to client
- Short-lived tokens (10min) for reading sessions
- X-Robots-Tag headers on all reader/proxy routes
- Row Level Security on all database tables

### Frontend
- epub.js for EPUB rendering
- Web Speech API for text-to-speech
- localStorage + server persistence for reading progress
- Auto-save progress every 15 seconds
- Keyboard navigation (Arrow keys)

## Testing

Use the smoke test scripts:

```bash
# Test search API
./scripts/search-smoke.sh

# Test reader API endpoints (requires auth)
./scripts/reader-api-smoke.sh
```

## Deployment

1. Run the Supabase migration (see above)
2. Set `APP_SIGNING_SECRET` environment variable
3. Deploy the application
4. Verify search works at `/api/search?q=plato`
5. Test reader login flow

## Notes

- Search results are source-agnostic on the client side
- No borrowing/paywalled content - only free public domain books
- All source APIs have built-in timeouts and error handling
- Failed sources don't block the entire search
