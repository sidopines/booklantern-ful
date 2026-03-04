# Playwright E2E Tests

Browser-based end-to-end tests that simulate real user flows.

## Prerequisites

```bash
npm i -D @playwright/test
npx playwright install --with-deps
```

## What is tested

### `favorites.spec.js` — Favorites flow

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Navigate to `/read?q=islam` | Results grid renders with cards |
| 2 | Click the first readable result | Reader page loads |
| 3 | Assert reader page | Does **not** show "Unable to load this book" |
| 4 | Click favourite (heart) button | `aria-pressed` toggles to `"true"` |
| 5 | Navigate to `/account` | Favorites section renders |
| 6 | Click first favorite card | Reader opens |
| 7 | Assert reader page | Does **not** show "Unable to load this book" |
| 8 | Cleanup: un-favorite | Leaves state clean |

## Authentication

The `/read` page is **gated** — it requires a logged-in session. Without
credentials the test is **skipped**, not failed.

Provide credentials via one of these env vars:

| Env var | Description |
|---------|-------------|
| `AUTH_COOKIE` | Raw cookie string (e.g. `connect.sid=s%3A…; bl_sub=…`) |
| `SUPABASE_TOKEN` | Supabase access token — the test will call `/api/auth/session-cookie` to create a server session |

## Running locally

```bash
# Terminal 1 — start the server
npm start

# Terminal 2 — run E2E tests
AUTH_COOKIE="connect.sid=s%3A..." npm run e2e
```

## Override base URL

```bash
BASE_URL=https://booklantern.org AUTH_COOKIE="..." npm run e2e
```

## Running without auth (skip mode)

```bash
npm run e2e
# → The favorites test will print "Skipped" since no auth is provided.
```

## Test artifacts

On failure, Playwright saves:
- **Screenshots** in `test-results/` (e.g. `reader-load-error.png`)
- **Traces** in `test-results/` (viewable with `npx playwright show-trace`)

## CI integration

```yaml
- name: E2E tests
  run: npm run e2e
  env:
    BASE_URL: ${{ vars.E2E_BASE_URL }}
    AUTH_COOKIE: ${{ secrets.E2E_AUTH_COOKIE }}
```
