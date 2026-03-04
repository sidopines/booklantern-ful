#!/usr/bin/env node
/**
 * Smoke-test suite for BookLantern.
 *
 * Usage:
 *   node scripts/smoke.mjs                         # localhost:10000
 *   BASE_URL=https://booklantern.org node scripts/smoke.mjs
 *   AUTH_COOKIE="sb-access-token=..." node scripts/smoke.mjs
 */

const BASE = (process.env.BASE_URL || "http://localhost:10000").replace(
  /\/$/,
  ""
);
const AUTH_COOKIE = process.env.AUTH_COOKIE || "";

const results = []; // { name, pass, detail }

// ── helpers ────────────────────────────────────────────────────────────

async function http(method, path, { headers = {}, expectJson = false } = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { method, headers, redirect: "manual" });
  const body = expectJson ? await res.json() : null;
  return { status: res.status, body };
}

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const tag = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${tag}  ${name}${detail ? "  — " + detail : ""}`);
}

// ── checks ─────────────────────────────────────────────────────────────

async function checkSearchApi() {
  const name = "GET /api/search?q=islam → 200 + JSON array";
  try {
    const hdrs = AUTH_COOKIE ? { Cookie: AUTH_COOKIE } : {};
    const url = `${BASE}/api/search?q=islam`;
    const res = await fetch(url, { method: "GET", headers: hdrs, redirect: "manual" });
    const status = res.status;

    // Without auth, gated endpoints may return 401/403 — that's expected
    if (!AUTH_COOKIE && (status === 401 || status === 403)) {
      console.log(`  ⏭ SKIP  ${name}  — auth required (${status})`);
      return;
    }

    if (status !== 200) return record(name, false, `status ${status}`);
    const body = await res.json();
    const arr = Array.isArray(body) ? body : body?.results;
    if (!Array.isArray(arr))
      return record(name, false, "response is not an array (or .results)");
    record(name, true, `${arr.length} result(s)`);
  } catch (err) {
    record(name, false, err.message);
  }
}

async function checkProxyPdfArchiveId() {
  const name = "HEAD /api/proxy/pdf?archive_id=… → NOT 422";
  try {
    const { status } = await http(
      "HEAD",
      "/api/proxy/pdf?archive_id=cu31924074296231"
    );
    const pass = status !== 422;
    record(name, pass, `status ${status}`);
  } catch (err) {
    record(name, false, err.message);
  }
}

async function checkProxyPdfArchive() {
  const name = "HEAD /api/proxy/pdf?archive=… → NOT 422";
  try {
    const { status } = await http(
      "HEAD",
      "/api/proxy/pdf?archive=cu31924074296231"
    );
    const pass = status !== 422;
    record(name, pass, `status ${status}`);
  } catch (err) {
    record(name, false, err.message);
  }
}

async function checkReadingFavorites() {
  if (!AUTH_COOKIE) {
    console.log("  ⏭ SKIP  reading/favorites (AUTH_COOKIE not set)");
    return;
  }
  const name = "GET /api/reading/favorites?limit=10 (authed)";
  try {
    const { status, body } = await http(
      "GET",
      "/api/reading/favorites?limit=10",
      {
        headers: { Cookie: AUTH_COOKIE },
        expectJson: true,
      }
    );
    if (status !== 200) return record(name, false, `status ${status}`);
    const items = Array.isArray(body) ? body : body?.favorites ?? body?.items;
    if (!Array.isArray(items))
      return record(name, false, "response is not an array");

    // Every item must have open_url or external_url
    const missingUrl = items.filter(
      (i) => !i.open_url && !i.external_url
    );
    if (missingUrl.length)
      return record(
        name,
        false,
        `${missingUrl.length} item(s) missing open_url / external_url`
      );

    // No duplicate bookKey values
    const keys = items.map((i) => i.bookKey).filter(Boolean);
    const dupes = keys.filter((k, idx) => keys.indexOf(k) !== idx);
    if (dupes.length)
      return record(name, false, `duplicate bookKey(s): ${[...new Set(dupes)].join(", ")}`);

    record(name, true, `${items.length} favorite(s), no dupes`);
  } catch (err) {
    record(name, false, err.message);
  }
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔥 Smoke tests  →  ${BASE}\n`);

  await checkSearchApi();
  await checkProxyPdfArchiveId();
  await checkProxyPdfArchive();
  await checkReadingFavorites();

  // summary
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;

  console.log(`\n────────────────────────────────`);
  console.log(`  Total: ${total}   Passed: ${passed}   Failed: ${failed}`);
  console.log(`────────────────────────────────\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
