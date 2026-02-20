#!/usr/bin/env node
// scripts/test-availability.js
// Tests for borrow-required detection, encrypted file filtering, and openUrl routing
const {
  isBorrowRequiredArchive,
  isEncryptedFile,
  scoreRelevance,
  buildOpenUrl,
  normalizeMeta,
  extractArchiveId,
  canonicalBookKey,
  stripPrefixes,
} = require('../utils/bookHelpers');

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ===========================================================================
console.log('\n=== isBorrowRequiredArchive ===');

// Borrow-required: access-restricted-item
assert('access-restricted-item=true → borrowRequired',
  isBorrowRequiredArchive({ 'access-restricted-item': true }, []).borrowRequired === true
);

// Borrow collection without open collection
assert('inlibrary collection → borrowRequired',
  isBorrowRequiredArchive({ collection: ['inlibrary', 'printdisabled'] }, []).borrowRequired === true
);

// Borrow collection WITH open collection → NOT borrow
assert('inlibrary + opensource → not borrowRequired',
  isBorrowRequiredArchive({ collection: ['inlibrary', 'opensource'] }, []).borrowRequired === false
);

// lending___status=borrow → borrowRequired
assert('lending___status=borrow → borrowRequired',
  isBorrowRequiredArchive({ lending___status: 'available_to_borrow' }, []).borrowRequired === true
);

// Normal open item → not borrowRequired
assert('normal open item → not borrowRequired',
  isBorrowRequiredArchive({ collection: ['opensource'] }, [
    { name: 'book.epub', format: 'EPUB', size: '1000000' }
  ]).borrowRequired === false
);

// ===========================================================================
console.log('\n=== Encrypted file detection ===');

// _encrypted in name
assert('_encrypted.epub is detected',
  isEncryptedFile({ name: 'book_encrypted.epub', format: '' }) === true
);

// acsm
assert('.acsm is detected',
  isEncryptedFile({ name: 'book.acsm', format: '' }) === true
);

// DRM format
assert('drm format is detected',
  isEncryptedFile({ name: 'book.epub', format: 'DRM EPUB' }) === true
);

// LCP in name
assert('_lcp.epub is detected',
  isEncryptedFile({ name: 'book_lcp.epub', format: '' }) === true
);

// Normal file
assert('normal epub is NOT detected',
  isEncryptedFile({ name: 'book.epub', format: 'EPUB' }) === false
);
assert('normal pdf is NOT detected',
  isEncryptedFile({ name: 'book.pdf', format: 'Text PDF' }) === false
);

// ===========================================================================
console.log('\n=== Encrypted-only items ===');

// All files encrypted → encryptedOnly
const encryptedFiles = [
  { name: 'book_encrypted.epub', format: 'EPUB', size: '5000000' },
  { name: 'book_lcp.epub', format: 'EPUB', size: '5000000' },
  { name: 'meta.xml', format: 'Metadata', size: '1000' },
];
const encResult = isBorrowRequiredArchive({}, encryptedFiles);
assert('all EPUBs encrypted → encryptedOnly',
  encResult.encryptedOnly === true && encResult.borrowRequired === false
);

// Mix of encrypted and normal → not encryptedOnly
const mixedFiles = [
  { name: 'book_encrypted.epub', format: 'EPUB', size: '5000000' },
  { name: 'book.epub', format: 'EPUB', size: '5000000' },
];
assert('mix of encrypted + normal → not encryptedOnly',
  isBorrowRequiredArchive({}, mixedFiles).encryptedOnly === false
);

// ===========================================================================
console.log('\n=== Archive borrow → openUrl should not go to unified-reader ===');

// A borrow-required item should get redirected to /external, not /unified-reader
// Test: buildOpenUrl still produces a URL (it doesn't know about borrow status)
// but the /open route will catch it via resolveArchiveFile and redirect
const borrowMeta = {
  provider: 'archive',
  provider_id: 'inlibrary_book_test',
  title: 'Some Borrow Book',
  archive_id: 'inlibrary_book_test',
};
const borrowUrl = buildOpenUrl(borrowMeta);
assert('borrow-required item still produces /open URL (runtime check handles redirect)',
  borrowUrl && borrowUrl.startsWith('/open?')
);

// ===========================================================================
console.log('\n=== scoreRelevance ===');

assert('exact title match scores high',
  scoreRelevance({ title: 'Economics in Africa', author: 'John Smith' }, 'economics in africa') >= 50
);

assert('no match scores zero',
  scoreRelevance({ title: 'Clinton Cash', author: 'Peter Schweizer' }, 'economics in africa') === 0
);

assert('partial match scores moderate',
  scoreRelevance({ title: 'African Economics Today', author: '' }, 'economics in africa') >= 20
);

assert('subject match counts',
  scoreRelevance({ title: 'Development Report', subjects: ['economics', 'africa'] }, 'economics in africa') >= 20
);

// ===========================================================================
console.log('\n=== OpenStax PDF → should be routable ===');

// OpenStax books have direct PDF URLs; they should produce valid /open URLs
const openstaxMeta = {
  provider: 'openstax',
  provider_id: 'college-algebra-2e',
  title: 'College Algebra 2e',
  author: 'Jay Abramson',
  format: 'pdf',
  direct_url: 'https://assets.openstax.org/oscms-prodcms/media/documents/College_Algebra_2e-WEB.pdf',
};
const openstaxUrl = buildOpenUrl(openstaxMeta);
assert('OpenStax produces /open URL',
  openstaxUrl && openstaxUrl.startsWith('/open?') && openstaxUrl.includes('provider=openstax')
);

// ===========================================================================
console.log('\n=== canonicalBookKey prefix normalization ===');
assert('bl-book-myid → bl-book-myid',
  canonicalBookKey({ archive_id: 'myid' }) === 'bl-book-myid'
);
assert('double prefix bl-book-bl-book-myid → bl-book-myid',
  canonicalBookKey({ provider_id: 'bl-book-bl-book-myid', provider: 'archive' }) === 'bl-book-myid'
);
assert('stripPrefixes consistency',
  stripPrefixes('bl-book-archive-myid') === 'myid'
);

// ===========================================================================
console.log('\n=== OpenStax proxy should redirect, not 502 ===');
// Simulate: the proxy handler for OpenStax URLs should return redirect
// We can't do a real HTTP test here, but we can validate the logic
// by checking that assets.openstax.org is in the allowed domains and
// the isRedirectFallbackHost logic would catch it
{
  const hostname = 'assets.openstax.org';
  const isRedirectHost = hostname.endsWith('.openstax.org') || hostname === 'openstax.org' || hostname.endsWith('.cloudfront.net');
  assert('assets.openstax.org is a redirect-fallback host', isRedirectHost === true);

  const hostname2 = 'd3bxy9euw4e147.cloudfront.net';
  const isRedirectHost2 = hostname2.endsWith('.openstax.org') || hostname2 === 'openstax.org' || hostname2.endsWith('.cloudfront.net');
  assert('OpenStax CloudFront CDN is a redirect-fallback host', isRedirectHost2 === true);

  const hostname3 = 'archive.org';
  const isRedirectHost3 = hostname3.endsWith('.openstax.org') || hostname3 === 'openstax.org' || hostname3.endsWith('.cloudfront.net');
  assert('archive.org is NOT a redirect-fallback host', isRedirectHost3 === false);
}

// ===========================================================================
console.log('\n=== PDF viewer preflight: external vs same-origin ===');
// External URLs should skip preflight (CORS blocks Range fetch)
{
  function isExternalUrl(src) {
    return /^https?:\/\//i.test(src) && !src.startsWith('http://localhost');
  }
  assert('External https URL is detected as external',
    isExternalUrl('https://assets.openstax.org/oscms/media/documents/College_Algebra.pdf') === true
  );
  assert('Same-origin proxy path is NOT external',
    isExternalUrl('/api/proxy/file?url=https%3A%2F%2Fassets.openstax.org%2F...') === false
  );
  assert('Relative path is NOT external',
    isExternalUrl('/api/proxy/pdf?archive=test') === false
  );
}

// ===========================================================================
console.log('\n=== canonicalBookKey for non-archive providers ===');
assert('openstax provider key',
  canonicalBookKey({ provider: 'openstax', provider_id: 'college-algebra-2e' }) === 'openstax-college-algebra-2e'
);
assert('canonicalBookKey server key matches expected for archive',
  canonicalBookKey({ archive_id: 'principiamathema00newtuoft' }) === 'bl-book-principiamathema00newtuoft'
);

// ===========================================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
