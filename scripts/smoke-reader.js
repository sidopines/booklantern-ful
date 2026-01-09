#!/usr/bin/env node
/**
 * Smoke test for unified reader proxy and external token resolution
 * 
 * Tests:
 * 1. /api/external/token resolves OAPEN and DOAB handle URLs to direct_url and format
 * 2. /api/proxy/file supports Range requests and returns 206 with proper headers
 * 
 * Usage:
 *   node scripts/smoke-reader.js [--base-url http://localhost:10000]
 */

const BASE_URL = process.env.BASE_URL || process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1] || 'http://localhost:10000';

// Test URLs - using known working examples
const TEST_URLS = {
  // OAPEN examples
  oapen1: 'https://library.oapen.org/handle/20.500.12657/28025',  // Open Access in Media Studies
  oapen2: 'https://library.oapen.org/handle/20.500.12657/41809',  // Another working OAPEN book
  // DOAB examples - using URLs with known bitstreams
  doab1: 'https://directory.doabooks.org/handle/20.500.12854/33875',
  doab2: 'https://directory.doabooks.org/handle/20.500.12854/89171',
};

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

/**
 * Decode base64url string (JWT payload format)
 * Handles the URL-safe base64 encoding used in JWTs
 */
function base64UrlDecode(str) {
  // Replace URL-safe chars with standard base64 chars
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '=' to make length a multiple of 4
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Decode JWT and return payload object
 */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: expected 3 parts');
  }
  const payloadB64 = parts[1];
  const decodedPayload = base64UrlDecode(payloadB64);
  return JSON.parse(decodedPayload);
}

function log(color, prefix, msg) {
  console.log(`${colors[color]}[${prefix}]${colors.reset} ${msg}`);
}

async function testExternalToken(name, landingUrl) {
  log('cyan', 'TEST', `External token for ${name}: ${landingUrl}`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/external/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
      },
      body: JSON.stringify({
        landing_url: landingUrl,
        title: `Test ${name}`,
      }),
    });
    
    // Log response metadata for debugging
    const contentType = response.headers.get('content-type');
    const contentEncoding = response.headers.get('content-encoding');
    log('cyan', 'INFO', `Response status: ${response.status}, Content-Type: ${contentType}, Content-Encoding: ${contentEncoding || 'none'}`);
    
    // Read body as text first for safe parsing
    const bodyText = await response.text();
    
    // Try to parse JSON
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch (parseErr) {
      log('red', 'FAIL', `JSON parse error: ${parseErr.message}`);
      log('red', 'DEBUG', `Status: ${response.status}`);
      log('red', 'DEBUG', `Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);
      log('red', 'DEBUG', `Body (first 300 chars): ${bodyText.substring(0, 300)}`);
      return null;
    }
    
    if (!response.ok) {
      log('red', 'FAIL', `HTTP ${response.status}: ${response.statusText}`);
      log('red', 'DEBUG', `Response body: ${JSON.stringify(data)}`);
      return null;
    }
    
    if (!data.ok) {
      log('yellow', 'WARN', `No readable format found (open_url: ${data.open_url || 'none'})`);
      return null;
    }
    
    if (!data.token || !data.format) {
      log('red', 'FAIL', `Missing token or format in response`);
      log('red', 'DEBUG', `Response: ${JSON.stringify(data)}`);
      return null;
    }
    
    // Prefer direct_url from API response, fall back to decoded JWT payload
    let directUrl = data.direct_url || null;
    
    if (!directUrl) {
      // Extract direct_url from JWT payload
      try {
        const payload = decodeJwtPayload(data.token);
        directUrl = payload.direct_url;
      } catch (e) {
        log('yellow', 'WARN', `Could not decode JWT payload: ${e.message}`);
      }
    }
    
    log('green', 'PASS', `Format: ${data.format}, Direct URL: ${directUrl ? directUrl.substring(0, 60) + '...' : 'N/A'}`);
    
    return { format: data.format, directUrl, token: data.token };
  } catch (err) {
    log('red', 'FAIL', `Error: ${err.message}`);
    return null;
  }
}

async function testProxyRange(directUrl, token) {
  if (!directUrl || !token) {
    log('yellow', 'SKIP', 'No direct URL or token to test proxy range');
    return false;
  }
  
  log('cyan', 'TEST', `Proxy Range request: ${directUrl.substring(0, 60)}...`);
  
  try {
    // Use token-based auth (cookieless) for Range test
    const proxyUrl = `${BASE_URL}/api/proxy/file?token=${encodeURIComponent(token)}`;
    
    // Request first byte with Range header to test 206 support
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Range': 'bytes=0-0',
      },
    });
    
    const status = response.status;
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    // Log headers for diagnostics
    log('cyan', 'INFO', `Status: ${status}`);
    log('cyan', 'INFO', `Content-Type: ${contentType}`);
    log('cyan', 'INFO', `Content-Length: ${contentLength}`);
    log('cyan', 'INFO', `Accept-Ranges: ${acceptRanges}`);
    log('cyan', 'INFO', `Content-Range: ${contentRange}`);
    
    // Evaluate result based on status code
    // 206 + Content-Range → PASS (ideal case)
    // 200 → WARN (upstream doesn't honor Range; still acceptable)
    // 401/403 → FAIL (auth broken)
    // Any other status → FAIL
    
    if (status === 206) {
      if (contentRange) {
        log('green', 'PASS', `206 Partial Content with Content-Range: ${contentRange}`);
        return true;
      } else {
        log('red', 'FAIL', '206 returned but Content-Range header missing');
        return false;
      }
    } else if (status === 200) {
      // Upstream returned full content instead of partial - acceptable but not ideal
      log('yellow', 'WARN', `Got 200 instead of 206 (upstream doesn't honor Range)`);
      if (acceptRanges === 'bytes') {
        log('cyan', 'INFO', 'Accept-Ranges: bytes present (may support Range on subsequent requests)');
      }
      return true; // Still a pass - proxy auth worked, upstream just ignores Range
    } else if (status === 401 || status === 403) {
      log('red', 'FAIL', `Auth broken: ${status} (token verification failed or access denied)`);
      return false;
    } else {
      log('red', 'FAIL', `Unexpected status: ${status}`);
      return false;
    }
  } catch (err) {
    log('red', 'FAIL', `Error: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`\n${colors.cyan}=== Unified Reader Smoke Test ===${colors.reset}`);
  console.log(`Base URL: ${BASE_URL}\n`);
  
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  
  // Test OAPEN #1
  console.log(`\n${colors.cyan}--- OAPEN Test #1 ---${colors.reset}`);
  const oapen1Result = await testExternalToken('OAPEN-1', TEST_URLS.oapen1);
  if (oapen1Result) {
    passed++;
    const rangeOk = await testProxyRange(oapen1Result.directUrl, oapen1Result.token);
    if (rangeOk) passed++;
    else failed++;
  } else {
    failed++;
    skipped++;
  }
  
  // Test OAPEN #2
  console.log(`\n${colors.cyan}--- OAPEN Test #2 ---${colors.reset}`);
  const oapen2Result = await testExternalToken('OAPEN-2', TEST_URLS.oapen2);
  if (oapen2Result) {
    passed++;
    const rangeOk = await testProxyRange(oapen2Result.directUrl, oapen2Result.token);
    if (rangeOk) passed++;
    else failed++;
  } else {
    failed++;
    skipped++;
  }
  
  // Test DOAB #1
  console.log(`\n${colors.cyan}--- DOAB Test #1 ---${colors.reset}`);
  const doab1Result = await testExternalToken('DOAB-1', TEST_URLS.doab1);
  if (doab1Result) {
    passed++;
    const rangeOk = await testProxyRange(doab1Result.directUrl, doab1Result.token);
    if (rangeOk) passed++;
    else failed++;
  } else {
    failed++;
    skipped++;
  }
  
  // Test DOAB #2
  console.log(`\n${colors.cyan}--- DOAB Test #2 ---${colors.reset}`);
  const doab2Result = await testExternalToken('DOAB-2', TEST_URLS.doab2);
  if (doab2Result) {
    passed++;
    const rangeOk = await testProxyRange(doab2Result.directUrl, doab2Result.token);
    if (rangeOk) passed++;
    else failed++;
  } else {
    failed++;
    skipped++;
  }
  
  // Summary
  console.log(`\n${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  console.log(`${colors.yellow}Skipped: ${skipped}${colors.reset}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
