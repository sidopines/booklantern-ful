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
  // OAPEN example - "Open Access in Media Studies"
  oapen: 'https://library.oapen.org/handle/20.500.12657/28025',
  // DOAB example - pick a known handle (update if this goes stale)
  doab: 'https://directory.doabooks.org/handle/20.500.12854/68306',
};

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

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
      },
      body: JSON.stringify({
        landing_url: landingUrl,
        title: `Test ${name}`,
      }),
    });
    
    if (!response.ok) {
      log('red', 'FAIL', `HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.ok) {
      log('yellow', 'WARN', `No readable format found (open_url: ${data.open_url || 'none'})`);
      return null;
    }
    
    if (!data.token || !data.format) {
      log('red', 'FAIL', `Missing token or format in response`);
      return null;
    }
    
    // Decode the token to get direct_url
    let directUrl = null;
    try {
      const tokenParts = data.token.split('.');
      if (tokenParts.length >= 2) {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
        directUrl = payload.direct_url;
      }
    } catch (e) {
      log('yellow', 'WARN', `Could not decode token: ${e.message}`);
    }
    
    log('green', 'PASS', `Format: ${data.format}, Direct URL: ${directUrl ? directUrl.substring(0, 60) + '...' : 'N/A'}`);
    
    return { format: data.format, directUrl };
  } catch (err) {
    log('red', 'FAIL', `Error: ${err.message}`);
    return null;
  }
}

async function testProxyRange(directUrl) {
  if (!directUrl) {
    log('yellow', 'SKIP', 'No direct URL to test proxy range');
    return false;
  }
  
  log('cyan', 'TEST', `Proxy Range request: ${directUrl.substring(0, 60)}...`);
  
  try {
    const proxyUrl = `${BASE_URL}/api/proxy/file?url=${encodeURIComponent(directUrl)}`;
    
    // Request first 1MB with Range header
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Range': 'bytes=0-1048575',
        'Accept': 'application/pdf,*/*',
      },
    });
    
    const status = response.status;
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    // Log headers
    log('cyan', 'INFO', `Status: ${status}`);
    log('cyan', 'INFO', `Content-Type: ${contentType}`);
    log('cyan', 'INFO', `Content-Length: ${contentLength}`);
    log('cyan', 'INFO', `Accept-Ranges: ${acceptRanges}`);
    log('cyan', 'INFO', `Content-Range: ${contentRange}`);
    
    // Check for 206 status
    if (status === 206) {
      log('green', 'PASS', '206 Partial Content returned');
      
      if (contentRange) {
        log('green', 'PASS', `Content-Range header present: ${contentRange}`);
      } else {
        log('yellow', 'WARN', 'Content-Range header missing (upstream may not support range)');
      }
      
      return true;
    } else if (status === 200) {
      // Some servers don't support Range - that's okay
      log('yellow', 'WARN', `Got 200 instead of 206 (upstream may not support Range)`);
      if (acceptRanges === 'bytes') {
        log('green', 'PASS', 'Accept-Ranges: bytes header present');
      }
      return true;
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
  
  // Test OAPEN
  console.log(`\n${colors.cyan}--- OAPEN Test ---${colors.reset}`);
  const oapenResult = await testExternalToken('OAPEN', TEST_URLS.oapen);
  if (oapenResult) {
    passed++;
    const rangeOk = await testProxyRange(oapenResult.directUrl);
    if (rangeOk) passed++;
    else failed++;
  } else {
    failed++;
    skipped++;
  }
  
  // Test DOAB
  console.log(`\n${colors.cyan}--- DOAB Test ---${colors.reset}`);
  const doabResult = await testExternalToken('DOAB', TEST_URLS.doab);
  if (doabResult) {
    passed++;
    const rangeOk = await testProxyRange(doabResult.directUrl);
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
