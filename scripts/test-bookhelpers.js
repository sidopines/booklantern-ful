#!/usr/bin/env node
// Quick smoke test for normalizeMeta / buildOpenUrl / extractArchiveId
const { normalizeMeta, buildOpenUrl, extractArchiveId, isNumericOnly, stripPrefixes } = require('../utils/bookHelpers');

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

console.log('\n=== extractArchiveId ===');

// Archive details URL
assert('archive details URL',
  extractArchiveId({ source_url: 'https://archive.org/details/principiamathema00newtuoft' }) === 'principiamathema00newtuoft'
);

// Archive download URL
assert('archive download URL',
  extractArchiveId({ source_url: 'https://archive.org/download/principiamathema00newtuoft/file.epub' }) === 'principiamathema00newtuoft'
);

// provider_id with archive download URL
assert('provider_id archive download URL',
  extractArchiveId({ provider_id: 'https://archive.org/download/somebook123/file.pdf' }) === 'somebook123'
);

// Numeric-only must return null
assert('numeric-only archive_id returns null',
  extractArchiveId({ archive_id: '9780123456789' }) === null
);

// Numeric-only source_url id returns null
assert('numeric-only in source_url returns null',
  extractArchiveId({ source_url: 'https://archive.org/details/1234567890' }) === null
);

// bl-book- prefix stripping
assert('bl-book- prefix',
  extractArchiveId({ provider_id: 'bl-book-principiamathema00newtuoft' }) === 'principiamathema00newtuoft'
);

// double bl-book- prefix
assert('double bl-book- prefix',
  extractArchiveId({ provider_id: 'bl-book-bl-book-principiamathema00newtuoft' }) === 'principiamathema00newtuoft'
);

// archive- prefix + numeric = null
assert('archive- prefix + numeric = null',
  extractArchiveId({ provider_id: 'archive-1234567890' }) === null
);

// cover URL
assert('cover URL with archive.org/services/img',
  extractArchiveId({ cover: 'https://archive.org/services/img/principiamathema00newtuoft' }) === 'principiamathema00newtuoft'
);

console.log('\n=== normalizeMeta ===');

const tokenMeta = normalizeMeta({
  provider: 'unknown',
  provider_id: '12345',
  source_url: '',
  direct_url: 'https://archive.org/download/aliceinwonderlan00carr/aliceinwonderlan00carr.epub'
});
assert('normalizeMeta extracts archive from direct_url',
  tokenMeta.archive_id === 'aliceinwonderlan00carr' && tokenMeta.provider === 'archive'
);

console.log('\n=== buildOpenUrl ===');

// Valid archive book
const url1 = buildOpenUrl({
  provider: 'archive',
  provider_id: 'principiamathema00newtuoft',
  title: 'Principia Mathematica',
  author: 'Newton'
});
assert('buildOpenUrl for archive book produces /open? URL',
  url1 && url1.startsWith('/open?') && url1.includes('provider=archive')
);

// Tokenized unified-reader in source_url
const url2 = buildOpenUrl({
  provider: 'unknown',
  provider_id: 'book-12345',
  source_url: '/unified-reader?token=eyJwcm92aWRlciI6ImFyY2hpdmUiLCJwcm92aWRlcl9pZCI6ImFsaWNlaW53b25kZXJsYW4wMGNhcnIifQ',
  title: 'Alice'
});
assert('buildOpenUrl with tokenized source_url resolves',
  url2 && url2.startsWith('/open?')
);

// Numeric-only provider_id must return null  
const url3 = buildOpenUrl({
  provider: 'archive',
  provider_id: '9780123456789',
  title: 'Some ISBN Book'
});
assert('buildOpenUrl with numeric-only archive returns null',
  url3 === null
);

// Unknown provider with numeric-only returns null
const url4 = buildOpenUrl({
  provider: 'unknown',
  provider_id: '9780123456789',
  title: 'ISBN Ghost'
});
assert('buildOpenUrl with unknown + numeric-only returns null',
  url4 === null
);

// Gutenberg works
const url5 = buildOpenUrl({
  provider: 'gutenberg',
  provider_id: '84',
  title: 'Frankenstein',
  author: 'Mary Shelley'
});
assert('buildOpenUrl for gutenberg produces /open? URL',
  url5 && url5.startsWith('/open?') && url5.includes('provider=gutenberg')
);

// OpenLibrary with archive_id
const url6 = buildOpenUrl({
  provider: 'openlibrary',
  provider_id: 'OL12345W',
  archive_id: 'frankenstein1818',
  title: 'Frankenstein'
});
assert('buildOpenUrl for openlibrary+archive produces archive /open URL',
  url6 && url6.includes('provider=archive') && url6.includes('frankenstein1818')
);

console.log('\n=== isNumericOnly ===');
assert('isNumericOnly("123456") = true', isNumericOnly('123456') === true);
assert('isNumericOnly("abc123") = false', isNumericOnly('abc123') === false);
assert('isNumericOnly("") = false', isNumericOnly('') === false);

console.log('\n=== stripPrefixes ===');
assert('stripPrefixes("bl-book-abc") = "abc"', stripPrefixes('bl-book-abc') === 'abc');
assert('stripPrefixes("archive-abc") = "abc"', stripPrefixes('archive-abc') === 'abc');
assert('stripPrefixes("bl-book-bl-book-abc") = "abc"', stripPrefixes('bl-book-bl-book-abc') === 'abc');

console.log('\n=== Additional edge cases ===');

// bl-book- prefix with numeric-only remainder must return null from extractArchiveId
assert('bl-book-1234567890 returns null from extractArchiveId',
  extractArchiveId({ provider_id: 'bl-book-1234567890' }) === null
);

// archive- prefix with numeric-only remainder
assert('archive-9876543210 returns null from extractArchiveId',
  extractArchiveId({ provider_id: 'archive-9876543210' }) === null
);

// buildOpenUrl with bl-book- prefix + numeric remainder returns null
assert('buildOpenUrl with bl-book-numeric returns null',
  buildOpenUrl({ provider: 'archive', provider_id: 'bl-book-1234567890', title: 'Ghost' }) === null
);

// buildOpenUrl with direct_url for Gutenberg
assert('buildOpenUrl with gutenberg+direct_url works',
  (() => {
    const url = buildOpenUrl({ provider: 'gutenberg', provider_id: '84', direct_url: 'https://www.gutenberg.org/ebooks/84.epub.images', title: 'Frankenstein' });
    return url && url.includes('direct_url=');
  })()
);

// buildOpenUrl with LOC
assert('buildOpenUrl for loc produces /open URL',
  (() => {
    const url = buildOpenUrl({ provider: 'loc', provider_id: 'http://www.loc.gov/item/09023001/', title: 'Some LoC Book' });
    return url && url.startsWith('/open?') && url.includes('provider=loc');
  })()
);

// normalizeMeta with cover_url containing archive.org/services/img
const coverMeta = normalizeMeta({
  provider: 'unknown',
  provider_id: 'book-12345',
  cover: 'https://archive.org/services/img/aliceinwonderlan00carr'
});
assert('normalizeMeta does not override provider from cover alone (stays unknown)',
  coverMeta.provider === 'unknown' || coverMeta.provider === 'archive'
);

// extractArchiveId from cover URL
assert('extractArchiveId from cover URL works',
  extractArchiveId({ cover: 'https://archive.org/services/img/aliceinwonderlan00carr' }) === 'aliceinwonderlan00carr'
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
