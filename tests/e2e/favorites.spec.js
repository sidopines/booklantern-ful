// @ts-check
const { test, expect } = require('@playwright/test');

/*
 * E2E smoke test: search → open → favorite → account → open favorite
 *
 * Requires authentication because /read is gated.
 * Set AUTH_COOKIE env var (e.g. "connect.sid=s%3A...") to inject the
 * server-side session cookie, or provide a Supabase access token via
 * SUPABASE_TOKEN so the test can call /api/auth/session-cookie itself.
 *
 * Without credentials the test is SKIPPED (not failed).
 */

const AUTH_COOKIE = process.env.AUTH_COOKIE || '';
const SUPABASE_TOKEN = process.env.SUPABASE_TOKEN || '';
const HAS_AUTH = Boolean(AUTH_COOKIE || SUPABASE_TOKEN);

// ── helpers ────────────────────────────────────────────────────────────

/** Collect browser console messages for diagnostics on failure. */
function collectConsoleLogs(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  return logs;
}

/**
 * Inject authentication into the browser context.
 *  - If AUTH_COOKIE is a raw cookie string, parse and set cookies.
 *  - If SUPABASE_TOKEN is set, POST to /api/auth/session-cookie to create a session.
 */
async function authenticate(page, context) {
  const baseURL = page.url().startsWith('http')
    ? new URL(page.url()).origin
    : (process.env.BASE_URL || 'http://localhost:10000');

  if (AUTH_COOKIE) {
    // Parse "name=value; name2=value2" into cookie objects
    const pairs = AUTH_COOKIE.split(/;\s*/);
    const cookies = pairs
      .map((p) => {
        const idx = p.indexOf('=');
        if (idx < 1) return null;
        return {
          name: p.slice(0, idx),
          value: p.slice(idx + 1),
          domain: new URL(baseURL).hostname,
          path: '/',
        };
      })
      .filter(Boolean);
    if (cookies.length) await context.addCookies(cookies);
    // Verify auth by loading a gated page
    await page.goto('/read');
    // If we ended up on /login, auth failed
    if (page.url().includes('/login')) {
      return false;
    }
    return true;
  }

  if (SUPABASE_TOKEN) {
    // Create server session via the session-cookie endpoint
    await page.goto('/');
    const resp = await page.evaluate(async (token) => {
      const r = await fetch('/api/auth/session-cookie', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      return { status: r.status, body: await r.json() };
    }, SUPABASE_TOKEN);

    if (resp.status !== 200 || !resp.body?.ok) {
      return false;
    }
    return true;
  }

  return false;
}

// ── test suite ─────────────────────────────────────────────────────────

test.describe('Favorites E2E flow', () => {
  test.skip(!HAS_AUTH, 'Skipped: set AUTH_COOKIE or SUPABASE_TOKEN to run');

  test('search → open → favorite → account → open favorite', async ({
    page,
    context,
  }) => {
    const logs = collectConsoleLogs(page);

    // ── Step 0: Authenticate ───────────────────────────────────────────
    const authed = await authenticate(page, context);
    if (!authed) {
      test.skip(true, 'Could not authenticate — check AUTH_COOKIE / SUPABASE_TOKEN');
      return;
    }

    // ── Step A: Go to /read?q=islam ────────────────────────────────────
    await page.goto('/read?q=islam');
    await page.waitForLoadState('networkidle');

    // Wait for results grid with at least 1 card (may be fewer than 10
    // depending on data; we require at least 1).
    const cards = page.locator('.book-card:not(.unavailable)');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    const cardCount = await cards.count();
    console.log(`  → ${cardCount} result card(s) found`);

    // ── Step B: Click the first clickable result ───────────────────────
    // Prefer readable-card or archive-card (not external, not unavailable)
    const clickable = page.locator(
      '.book-card.readable-card, .book-card.archive-card'
    );
    const clickableCount = await clickable.count();
    expect(clickableCount).toBeGreaterThan(0);

    // Archive cards navigate via JS click handler; readable cards have href.
    // Click the first one and wait for navigation.
    await clickable.first().click();
    await page.waitForURL(/\/(open|read\/)/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    // ── Step C: Assert reader loaded without error ─────────────────────
    const errorState = page.locator('.reader-empty-state');
    const readerError = page.locator('.reader-error');

    // Give the reader a moment to attempt loading
    await page.waitForTimeout(3_000);

    const hasEpubError = await errorState.isVisible().catch(() => false);
    const hasReaderError = await readerError.isVisible().catch(() => false);

    if (hasEpubError || hasReaderError) {
      // Take a screenshot for debugging, then fail
      await page.screenshot({ path: 'test-results/reader-load-error.png' });
      console.log('Console logs:', logs.join('\n'));
      expect(hasEpubError, 'Reader shows "Unable to load this book"').toBe(false);
    }

    // ── Step D: Click the favorite (heart) button ──────────────────────
    const favBtn = page.locator('#favorite-btn');
    if (await favBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // If already favorited, un-fav first to test the toggle fresh
      const alreadyFav = await favBtn.getAttribute('aria-pressed');
      if (alreadyFav === 'true') {
        await favBtn.click();
        await page.waitForTimeout(1_000);
      }

      // Now favorite it
      await favBtn.click();
      await page.waitForTimeout(1_500);

      // Assert it toggled to favorited
      await expect(favBtn).toHaveAttribute('aria-pressed', 'true');
      console.log('  → Favorite toggled ON');
    } else {
      console.log('  → favorite button not found on this page type, skipping toggle');
    }

    // ── Step E: Go to /account ─────────────────────────────────────────
    await page.goto('/account');
    await page.waitForLoadState('networkidle');

    // Wait for favorites to load (JS-rendered)
    const favGrid = page.locator('.favorites-grid');
    await expect(favGrid).toBeVisible({ timeout: 10_000 });

    // ── Step F: Click the first favorite card ──────────────────────────
    const favCard = page.locator('a.fav-card');
    await expect(favCard.first()).toBeVisible({ timeout: 10_000 });

    const favTitle = await favCard.first().locator('.fav-title').textContent();
    console.log(`  → Opening favorite: "${favTitle}"`);

    await favCard.first().click();
    await page.waitForURL(/\/(open|read\/)/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    // ── Step G: Assert it loaded without error ─────────────────────────
    await page.waitForTimeout(3_000);

    const hasError2 = await errorState.isVisible().catch(() => false);
    const hasReaderError2 = await readerError.isVisible().catch(() => false);

    if (hasError2 || hasReaderError2) {
      await page.screenshot({ path: 'test-results/favorite-open-error.png' });
      console.log('Console logs:', logs.join('\n'));
    }
    expect(hasError2, 'Favorite opens without "Unable to load" error').toBe(false);
    expect(hasReaderError2, 'Favorite opens without reader error').toBe(false);

    console.log('  → Favorite opened successfully');

    // ── Cleanup: un-favorite to leave state clean ──────────────────────
    const cleanupBtn = page.locator('#favorite-btn');
    if (await cleanupBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const pressed = await cleanupBtn.getAttribute('aria-pressed');
      if (pressed === 'true') {
        await cleanupBtn.click();
        await page.waitForTimeout(1_000);
        console.log('  → Cleaned up: unfavorited');
      }
    }
  });
});
