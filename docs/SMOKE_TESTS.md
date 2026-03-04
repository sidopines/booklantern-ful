# Smoke Tests

Automated HTTP checks that verify key API endpoints are responding correctly.

## What is tested

| # | Endpoint | Assertion |
|---|----------|-----------|
| 1 | `GET /api/search?q=islam` | Status 200, JSON array of results |
| 2 | `HEAD /api/proxy/pdf?archive_id=cu31924074296231` | Status is **not** 422 |
| 3 | `HEAD /api/proxy/pdf?archive=cu31924074296231` | Status is **not** 422 |
| 4 | `GET /api/reading/favorites?limit=10` *(auth required)* | Each item has `open_url` or `external_url`; no duplicate `bookKey` values |

Test 4 is **skipped** unless an `AUTH_COOKIE` env var is provided.

## Running locally

Start the server first, then run the smoke tests. The default base URL is
`http://localhost:10000` (matching the app's default `PORT`).

```bash
# terminal 1 — start the app
npm start

# terminal 2 — run smoke tests against localhost
npm run smoke
```

## Running against production

```bash
BASE_URL=https://booklantern.org npm run smoke
```

## With authentication (optional)

```bash
AUTH_COOKIE="sb-access-token=<token>" npm run smoke
```

Or combine with a custom base URL:

```bash
BASE_URL=https://booklantern.org AUTH_COOKIE="sb-access-token=<token>" npm run smoke
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | All checks passed |
| `1`  | One or more checks failed |

## CI integration

Add to any CI pipeline:

```yaml
- name: Smoke tests
  run: npm run smoke
  env:
    BASE_URL: ${{ vars.SMOKE_BASE_URL }}
```
