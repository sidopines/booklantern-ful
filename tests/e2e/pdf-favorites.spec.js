// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * E2E test: PDF/catalog favorites must work without "viewer is not defined".
 *
 * Requires AUTH_COOKIE or SUPABASE_TOKEN (same as favorites.spec.js).
 * Without credentials the test is SKIPPED.
 */

const AUTH_COOKIE = process.env.AUTH_COOKIE || '';
const SUPABASE_TOKEN = process.env.SUPABASE_TOKEN || '';
const HAS_AUTH = Boolean(AUTH_COOKIE || SUPABASE_TOKEN);

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
    await page.goto('/read');
    if (page.url().includes('/login')) return false;
    // Also check for unauthenticated nav state
    const enterLib = await page.locator('a:has-text("Enter Library")').isVisible().catch(() => false);
    if (enterLib) return false;
    return true;
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

// ── test suite ───────────────────────────────────────────────────────

test.describe('PDF/catalog favorites', () => {
  test.skip(!HAS_AUTH, 'Skipped: set AUTH_COOKIE or SUPABASE_TOKEN');

  test('favorite a PDF book without "viewer is not defined" and verify it appears in /read', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const logs = collectConsoleLogs(page);

    // ── Auth ──────────────────────────────────────────────────────────
    const authed = await authenticate(page, context);
    if (!authed) {
      test.skip(true, 'Could not authenticate');
      return;
    }
    // Save cookies so we can re-inject after reader visits invalidate the session
    const savedCookies = await context.cookies();

    // ── Step A: Search for a query likely to return PDF/catalog items ─
    await page.goto('/read?q=islam');
    await page.waitForLoadState('domcontentloaded');

    const cards = page.locator('.book-card:not(.unavailable)');
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });

    const cardCount = await cards.count();
    console.log(`  → ${cardCount} result card(s) found`);

    // ── Step B: Click candidates until we land on a PDF reader ────────
    let foundPdf = false;
    let bookTitle = '';
    const maxAttempts = Math.min(cardCount, 8);

    for (let i = 0; i < maxAttempts; i++) {
      const card = cards.nth(i);
      const visible = await card.isVisible().catch(() => false);
      if (!visible) continue;

      // Grab the title before navigating
      const titleEl = card.locator('.card-title');
      const candidateTitle = await titleEl.textContent().catch(() => '') || '';
      console.log(`  → Trying card ${i}: "${candidateTitle.trim()}"`);

      try {
        await Promise.all([
          page.waitForURL(/\/(unified-reader|reader|open)(\?|$)/, { timeout: 20_000 }),
          card.click(),
        ]);
      } catch {
        // Card navigated to an unexpected URL (e.g. /external) — skip it
        console.log(`  → Card ${i} navigated to unexpected URL: ${page.url()}, skipping`);
        await context.addCookies(savedCookies);
        await page.goto('/read?q=islam');
        await page.waitForLoadState('networkidle');
        await expect(cards.first()).toBeVisible({ timeout: 20_000 });
        continue;
      }
      await page.waitForLoadState('domcontentloaded');

      // Check if this is a PDF reader page
      const isPdf = await page.evaluate(() => {
        if (document.getElementById('direct-pdf-frame')) return true;
        if (document.getElementById('pdf-frame')) return true;
        if (document.body.getAttribute('data-pdf') === 'true') return true;
        if (document.body.getAttribute('data-format') === 'pdf') return true;
        const iframes = document.querySelectorAll('iframe');
        for (const f of iframes) {
          if ((f.src || '').includes('.pdf') || (f.src || '').includes('proxy/pdf') || (f.src || '').includes('proxy/file')) return true;
        }
        return false;
      });

      if (isPdf) {
        foundPdf = true;
        bookTitle = candidateTitle.trim();
        console.log(`  → Found PDF reader for: "${bookTitle}"`);
        break;
      }

      // Not a PDF — go back and try next card
      console.log(`  → Card ${i} is not PDF, going back`);
      // Re-inject auth cookies (reader visit can invalidate the session)
      await context.addCookies(savedCookies);
      await page.goto('/read?q=islam');
      await page.waitForLoadState('networkidle');
      await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    }

    if (!foundPdf) {
      test.skip(true, 'No PDF/catalog result found in first 8 results');
      return;
    }

    // ── Step C: Wait for favorite button ──────────────────────────────
    const favBtn = page.locator('#favorite-btn');
    await expect(favBtn).toBeVisible({ timeout: 15_000 });

    // If already favorited, un-fav first
    const alreadyFav = await favBtn.getAttribute('aria-pressed');
    if (alreadyFav === 'true') {
      await favBtn.click();
      await page.waitForResponse(
        (r) => r.url().includes('favorite') && r.status() === 200,
        { timeout: 10_000 }
      ).catch(() => {});
      await page.waitForTimeout(500);
    }

    // ── Step D: Click favorite and assert no "viewer" error ──────────
    // Clear existing logs so we only check errors from this point
    const preClickLogCount = logs.length;

    const respPromise = page.waitForResponse(
      (r) => r.url().includes('favorite') && r.status() === 200,
      { timeout: 15_000 }
    ).catch(() => null);

    await favBtn.click();
    const resp = await respPromise;

    expect(resp, 'Favorite API should respond 200').toBeTruthy();

    if (resp) {
      const body = await resp.json().catch(() => null);
      console.log(`  → Favorite API: ${resp.status()} favorited=${body?.favorited}`);
      expect(body?.ok).toBe(true);
      expect(body?.favorited).toBe(true);
    }

    // Check NO console error contains "viewer is not defined"
    const postClickLogs = logs.slice(preClickLogCount);
    const viewerErrors = postClickLogs.filter(
      (l) => l.includes('viewer is not defined')
    );
    expect(
      viewerErrors,
      'No "viewer is not defined" console errors after clicking favorite'
    ).toHaveLength(0);

    // Heart should show favorited state
    await expect(favBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
    console.log('  → Favorite toggled ON, no viewer error');

    // ── Step E: Navigate to /read and check "Your Favorites" row ─────
    await page.goto('/read');
    await page.waitForLoadState('domcontentloaded');

    // Wait for favorites shelf to appear
    const favShelf = page.locator('#favorites-shelf');
    await expect(favShelf).toBeVisible({ timeout: 15_000 });

    // Check that the favorited title appears in the shelf
    const favItems = favShelf.locator('.shelf-card');
    await expect(favItems.first()).toBeVisible({ timeout: 10_000 });

    const favCount = await favItems.count();
    console.log(`  → ${favCount} favorite(s) in shelf`);

    // Look for our book title in the shelf
    let foundInShelf = false;
    for (let i = 0; i < favCount; i++) {
      const shelfTitle = await favItems.nth(i).locator('.card-title').textContent().catch(() => '');
      if (shelfTitle && bookTitle && shelfTitle.trim().toLowerCase().includes(bookTitle.substring(0, 20).toLowerCase())) {
        foundInShelf = true;
        console.log(`  → Found "${shelfTitle.trim()}" in favorites shelf`);
        break;
      }
    }
    expect(foundInShelf, `"${bookTitle}" should appear in /read favorites shelf`).toBe(true);

    // ── Cleanup: unfavorite the book ─────────────────────────────────
    // Click the book from favorites to go back to reader
    const matchingCard = favItems.filter({ hasText: bookTitle.substring(0, 20) }).first();
    if (await matchingCard.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/(unified-reader|reader|open)(\?|$)/, { timeout: 20_000 }),
        matchingCard.click(),
      ]);
      await page.waitForLoadState('domcontentloaded');

      const cleanupBtn = page.locator('#favorite-btn');
      await cleanupBtn.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      const pressed = await cleanupBtn.getAttribute('aria-pressed').catch(() => '');
      if (pressed === 'true') {
        await cleanupBtn.click();
        await page.waitForResponse(
          (r) => r.url().includes('favorite') && r.status() === 200,
          { timeout: 10_000 }
        ).catch(() => {});
        console.log('  → Cleanup: unfavorited');
      }
    }
  });
});
