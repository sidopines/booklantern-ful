const https = require('https');

function once(url, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('timeout')); });
  });
}

module.exports = async function fetchJsonRetry(url, { tries = 2, timeout = 8000, waitMs = 300 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await once(url, { timeout }); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, waitMs)); }
  }
  throw last || new Error('fetch failed');
};
