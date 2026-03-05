// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * E2E test: favorite deduplication and heart-state consistency.
 *
 * Uses a deterministic reader URL (Gutenberg book 1513 – Romeo and Juliet)
 * so the test doesn't depend on search result order.
 *
 * Flow:
 *   1. Open the reader directly → toggle favorite ON
 *   2. Navigate to /read → verify exactly 1 shelf entry (no duplicates)
 *   3. Navigate to /account → verify exactly 1 favorites-grid entry
 *   4. Cleanup: unfavorite from the reader
 *
 * Requires AUTH_COOKIE or SUPABASE_TOKEN. Skipped without credentials.
 */

const AUTH_COOKIE = process.env.AUTH_COOKIE || '';
const SUPABASE_TOKEN = process.env.SUPABASE_TOKEN || '';
const HAS_AUTH = Boolean(AUTH_COOKIE || SUPABASE_TOKEN);

// Deterministic Gutenberg book: Romeo and Juliet (ID 1513)
const TEST_BOOK = {
  provider: 'gutenberg',
  provider_id: '1513',
  title: 'Romeo and Juliet',
  author: 'William Shakespeare',
  cover_url: '',
  format: 'epub',
  direct_url: '',
};
const BOOK_KEY = `bl:${TEST_BOOK.provider}:${TEST_BOOK.provider_id}`;

function buildReaderToken(book) {
  const data = {
    provider: book.provider || '',
    provider_id: book.provider_id || '',
    title: book.title || '',
    author: book.author || '',
    cover_url: book.cover_url || '',
    format: (book.format || 'epub').toLowerCase(),
    direct_url: book.direct_url || '',
  };
  const payload = { data, exp: Date.now() + 1000 * 60 * 60 * 24 };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

// ── helpers ──────────────────────────────────────────────────────────

function collectConsoleLogs(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  return logs;
}

async function authenticate(page, context) {
  const baseURL = page.url().startsWith('http')
    ? new URL(page.url()).origin
    : (process.env.BASE_URL || 'http://localhost:10000');

  if (AUTH_COOKIE) {
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

    // Navigate to /read — may hit Render free-tier interstitial
    await page.goto('/read', { timeout: 60_000, waitUntil: 'domcontentloaded' });

    // Wait for the actual app to load (Render interstitial may show first)
    const maxWait = 60_000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const url = page.url();
      // If we're on a Render interstitial, wait and reload
      const isInterstitial = await page.locator('text=Service waking up').isVisible().catch(() => false)
        || await page.locator('text=Application loading').isVisible().catch(() => false);
      if (isInterstitial) {
        console.log('  → Render interstitial detected, waiting...');
        await page.waitForTimeout(5_000);
        await page.reload({ timeout: 30_000, waitUntil: 'domcontentloaded' }).catch(() => {});
        continue;
      }
      // If we're on /login, auth is invalid
      if (url.includes('/login')) return false;
      // If we see "Enter Library", not authenticated
      const enterLib = await page.locator('a:has-text("Enter Library")').isVisible().catch(() => false);
      if (enterLib) return false;
      // If we're on /read and the page has loaded, we're good
      if (url.includes('/read')) return true;
      // Otherwise wait a bit
      await page.waitForTimeout(2_000);
    }
    return false;
  }

  if (SUPABASE_TOKEN) {
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
    return resp.status === 200 && resp.body?.ok;
  }

  return false;
}

/**
 * Ensure the book is NOT favorited before the test starts.
 * Calls the toggle API if the book is currently favorited.
 */
async function ensureUnfavorited(page) {
  const result = await page.evaluate(async (bk) => {
    try {
      const res = await fetch(`/api/reading/favorite/${encodeURIComponent(bk)}`);
      if (!res.ok) return { favorited: false };
      return await res.json();
    } catch { return { favorited: false }; }
  }, BOOK_KEY);

  if (result.favorited) {
    // Toggle off via API
    await page.evaluate(async (book) => {
      await fetch('/api/reading/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookKey: `bl:${book.provider}:${book.provider_id}`,
          title: book.title,
          author: book.author,
          cover: book.cover_url,
          source: book.provider,
        }),
      });
    }, TEST_BOOK);
    console.log('  → Pre-cleanup: unfavorited existing entry');
  }
}

// ── test suite ───────────────────────────────────────────────────────

test.describe('Favorites deduplication', () => {
  test.skip(!HAS_AUTH, 'Skipped: set AUTH_COOKIE or SUPABASE_TOKEN');

  test('no duplicate favorites when toggling from reader, heart state synced', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const logs = collectConsoleLogs(page);

    // ── Auth ─────────────────────────────────────────────────────────
    const authed = await authenticate(page, context);
    if (!authed) {
      test.skip(true, 'Could not authenticate — check AUTH_COOKIE / SUPABASE_TOKEN');
      return;
    }
    const savedCookies = await context.cookies();

    // ── Pre-cleanup: ensure book is not favorited ────────────────────
    await ensureUnfavorited(page);

    // ── Step 1: Open reader with deterministic token ─────────────────
    const token = buildReaderToken(TEST_BOOK);
    await page.goto(`/unified-reader?token=${token}`);
    await page.waitForLoadState('domcontentloaded');

    const favBtn = page.locator('#favorite-btn');
    await expect(favBtn).toBeVisible({ timeout: 20_000 });

    // Ensure it's currently not favorited
    const initialPressed = await favBtn.getAttribute('aria-pressed');
    if (initialPressed === 'true') {
      // Shouldn't happen after pre-cleanup, but handle it
      await favBtn.click();
      await page.waitForResponse(
        (r) => r.url().includes('favorite') && r.status() === 200,
        { timeout: 10_000 }
      ).catch(() => {});
      await page.waitForTimeout(500);
    }

    // ── Step 2: Favorite from reader ─────────────────────────────────
    const resp1 = page.waitForResponse(
      (r) => r.url().includes('/api/reading/favorite') && r.status() === 200,
      { timeout: 15_000 }
    );
    await favBtn.click();
    const favResp = await resp1;
    const favBody = await favResp.json().catch(() => null);

    expect(favBody?.ok, 'Favorite API responded ok').toBe(true);
    expect(favBody?.favorited, 'Book should be favorited').toBe(true);
    expect(favBody?.canonicalBookKey, 'Response includes canonicalBookKey').toBeTruthy();
    console.log(`  → Favorited from reader, canonicalBookKey=${favBody?.canonicalBookKey}`);

    await expect(favBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

    // ── Step 3: Go to /read and check favorites shelf ────────────────
    await context.addCookies(savedCookies);
    await page.goto('/read');
    await page.waitForLoadState('domcontentloaded');

    const favShelf = page.locator('#favorites-shelf');
    await expect(favShelf).toBeVisible({ timeout: 15_000 });

    const shelfCards = favShelf.locator('.shelf-card');
    await expect(shelfCards.first()).toBeVisible({ timeout: 10_000 });

    // Count how many shelf cards match our book title
    const shelfCount = await shelfCards.count();
    let matchCount = 0;
    for (let i = 0; i < shelfCount; i++) {
      const title = await shelfCards.nth(i).locator('.card-title').textContent().catch(() => '');
      if (title && title.trim().toLowerCase().includes('romeo')) {
        matchCount++;
      }
    }
    console.log(`  → Shelf has ${shelfCount} card(s), ${matchCount} match(es) for Romeo`);
    expect(matchCount, 'Exactly 1 entry for Romeo in favorites shelf (no duplicates)').toBe(1);

    // ── Step 4: Go to /account and check favorites grid ──────────────
    await page.goto('/account');
    await page.waitForLoadState('domcontentloaded');

    const favGrid = page.locator('.favorites-grid');
    await expect(favGrid).toBeVisible({ timeout: 10_000 });

    const favCards = favGrid.locator('a.fav-card');
    await expect(favCards.first()).toBeVisible({ timeout: 10_000 });

    const accountCount = await favCards.count();
    let accountMatchCount = 0;
    for (let i = 0; i < accountCount; i++) {
      const title = await favCards.nth(i).locator('.fav-title').textContent().catch(() => '');
      if (title && title.trim().toLowerCase().includes('romeo')) {
        accountMatchCount++;
      }
    }
    console.log(`  → Account has ${accountCount} favorite(s), ${accountMatchCount} match(es) for Romeo`);
    expect(accountMatchCount, 'Exactly 1 entry for Romeo on /account (no duplicates)').toBe(1);

    // ── Step 5: Re-open reader and verify heart is still ON ──────────
    await context.addCookies(savedCookies);
    await page.goto(`/unified-reader?token=${token}`);
    await page.waitForLoadState('domcontentloaded');

    const favBtn2 = page.locator('#favorite-btn');
    await expect(favBtn2).toBeVisible({ timeout: 20_000 });
    await expect(favBtn2).toHaveAttribute('aria-pressed', 'true', {
      timeout: 10_000,
    });
    console.log('  → Heart still ON after re-opening reader');

    // ── Step 6: Toggle off → on again, still no duplicates ───────────
    // Toggle off
    const offResp = page.waitForResponse(
      (r) => r.url().includes('/api/reading/favorite') && r.status() === 200,
      { timeout: 10_000 }
    );
    await favBtn2.click();
    await offResp;
    await page.waitForTimeout(300);

    // Toggle on again
    const onResp = page.waitForResponse(
      (r) => r.url().includes('/api/reading/favorite') && r.status() === 200,
      { timeout: 10_000 }
    );
    await favBtn2.click();
    const onBody = await (await onResp).json().catch(() => null);
    expect(onBody?.favorited).toBe(true);
    console.log('  → Re-favorited (off→on cycle)');

    // Check shelf again
    await context.addCookies(savedCookies);
    await page.goto('/read');
    await page.waitForLoadState('domcontentloaded');
    await expect(favShelf).toBeVisible({ timeout: 15_000 });
    await expect(shelfCards.first()).toBeVisible({ timeout: 10_000 });

    const shelfCount2 = await shelfCards.count();
    let matchCount2 = 0;
    for (let i = 0; i < shelfCount2; i++) {
      const title = await shelfCards.nth(i).locator('.card-title').textContent().catch(() => '');
      if (title && title.trim().toLowerCase().includes('romeo')) {
        matchCount2++;
      }
    }
    console.log(`  → After re-fav: shelf has ${shelfCount2} card(s), ${matchCount2} Romeo match(es)`);
    expect(matchCount2, 'Still exactly 1 entry after off→on cycle').toBe(1);

    // ── Cleanup: unfavorite ──────────────────────────────────────────
    await context.addCookies(savedCookies);
    await page.goto(`/unified-reader?token=${token}`);
    await page.waitForLoadState('domcontentloaded');
    const cleanupBtn = page.locator('#favorite-btn');
    await cleanupBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    const pressed = await cleanupBtn.getAttribute('aria-pressed').catch(() => '');
    if (pressed === 'true') {
      await cleanupBtn.click();
      await page.waitForResponse(
        (r) => r.url().includes('favorite') && r.status() === 200,
        { timeout: 10_000 }
      ).catch(() => {});
      console.log('  → Cleanup: unfavorited');
    }
  });
});
