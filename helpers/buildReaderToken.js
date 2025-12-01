// helpers/buildReaderToken.js
module.exports = function buildReaderToken(book) {
  // book: { provider, provider_id, title, author, cover_url, direct_url, format }
  const data = {
    provider: book.provider || '',
    provider_id: book.provider_id || '',
    title: book.title || '',
    author: book.author || '',
    cover_url: book.cover_url || '',
    format: (book.format || 'epub').toLowerCase(),
    direct_url: book.direct_url || ''
  };
  const payload = { data, exp: Date.now() + 1000 * 60 * 60 * 24 }; // 24h
  return Buffer.from(JSON.stringify(payload)).toString('base64');
};
