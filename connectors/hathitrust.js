// connectors/hathitrust.js
// HathiTrust SRU search -> filter to Full View / Public Domain items using Volumes API
// SRU docs: https://catalog.hathitrust.org/api/volumes/brief/sru
// Volumes API: https://catalog.hathitrust.org/api/volumes/ (brief/json/<id>)
// NOTE: Hathi viewer forbids embedding for most items; we link out in a new tab (frontend already does this for non-internal sources).

const SRU_BASE =
  'https://catalog.hathitrust.org/api/volumes/brief/sru?operation=searchRetrieve&version=1.1';
const MAX_PER_RECORD_LOOKUPS = 2; // keep it conservative to avoid hammering Volumes API

// --- tiny helpers ------------------------------------------------------------
function pickIdentifier(ids) {
  // Prefer oclc > isbn > lccn; fall back to the first identifier
  const oclc = ids.find((x) => /^oclc:/i.test(x));
  if (oclc) return oclc;
  const isbn = ids.find((x) => /^isbn:/i.test(x));
  if (isbn) return isbn;
  const lccn = ids.find((x) => /^lccn:/i.test(x));
  if (lccn) return lccn;
  return ids[0] || null;
}

function safeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// super light XML extraction (no external deps)
function extractAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function extractFirst(xml, tag) {
  const a = extractAll(xml, tag);
  return a.length ? a[0] : '';
}

// Parse SRU DC record to minimal object
function parseDCRecord(recordXml) {
  const title = safeText(extractFirst(recordXml, 'dc:title'));
  const creator = safeText(extractFirst(recordXml, 'dc:creator')) || safeText(extractFirst(recordXml, 'dc:creator'));
  const identifiers = extractAll(recordXml, 'dc:identifier')
    .map((x) => safeText(x))
    .filter(Boolean);

  // Catalog record number (for logging/debug)
  const recId = safeText(extractFirst(recordXml, 'srw:recordIdentifier')) ||
                safeText(extractFirst(recordXml, 'recordIdentifier'));

  return { title, creator, identifiers, recId };
}

// Query Volumes API for rights + links
async function volumesBriefJson(id) {
  // id looks like "oclc:12345" or "isbn:..." etc.
  const url = `https://catalog.hathitrust.org/api/volumes/brief/json/${encodeURIComponent(id)}`;
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Volumes API ${r.status}`);
  return r.json();
}

// Map a volumes brief/json payload to Full-View cards
function volumesToCards(json, fallbackTitle, fallbackCreator) {
  const cards = [];
  const keys = Object.keys(json || {});
  for (const k of keys) {
    const entry = json[k];
    // entry.records is an array of bib records; each has .items
    const recs = Array.isArray(entry?.records) ? entry.records : [];
    for (const rec of recs) {
      const items = Array.isArray(rec?.items) ? rec.items : [];
      for (const it of items) {
        const rightsCode = String(it?.rightsCode || '').toLowerCase(); // e.g., 'pd', 'pdus', 'ic', ...
        const usRights = String(it?.usRightsString || '').toLowerCase(); // 'full view', 'limited', ...
        const isFull =
          rightsCode === 'pd' || rightsCode === 'pdus' || /full\s*view/.test(usRights);

        if (!isFull) continue;

        const itemURL = it?.itemURL; // Hathi canonical reader URL (external)
        if (!itemURL) continue;

        const cover = it?.thumbnail || it?.image || ''; // some items include image/thumbnail
        // Get PDF URL if available
        const pdfUrl = it?.pdfUrl || it?.downloadUrl || '';
        
        cards.push({
          identifier: `hathi:${it?.htid || itemURL}`,
          title: safeText(rec?.title) || fallbackTitle || '(Untitled)',
          creator: safeText(rec?.mainAuthor) || fallbackCreator || '',
          cover,
          source: 'hathitrust',
          openInline: true,
          readable: true,
          href: pdfUrl ? `/read/pdf?src=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(safeText(rec?.title) || fallbackTitle || '')}` : itemURL,
          readerUrl: pdfUrl ? `/read/pdf?src=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(safeText(rec?.title) || fallbackTitle || '')}` : itemURL,
        });
      }
    }
  }
  return cards;
}

// --- main search -------------------------------------------------------------
async function searchHathiFullView(q, limit = 24) {
  try {
    // SRU free-text against DC; request DC schema for simpler parsing.
    const cql = `dc.any all "${q}"`;
    const sruUrl =
      `${SRU_BASE}&recordSchema=dc&maximumRecords=${limit}&query=${encodeURIComponent(cql)}`;

    const r = await fetch(sruUrl, { redirect: 'follow' });
    if (!r.ok) throw new Error(`SRU status ${r.status}`);
    const xml = await r.text();

    // Split into <record> blocks
    const recBlocks = xml.match(/<srw:record>[\s\S]*?<\/srw:record>/gi) || [];
    if (!recBlocks.length) return [];

    const cards = [];
    for (const block of recBlocks) {
      const dc = extractFirst(block, 'srw:recordData') || block; // some responses nest DC inside recordData
      const parsed = parseDCRecord(dc);
      if (!parsed.identifiers?.length) continue;

      // Try a couple of identifiers to find items via Volumes API
      const idCandidates = [];
      const idsNorm = parsed.identifiers.map((x) => x.toLowerCase());
      // keep only supported namespaces
      idsNorm.forEach((id) => {
        if (/^(oclc|isbn|lccn):/.test(id)) idCandidates.push(id);
      });
      if (!idCandidates.length) {
        // sometimes identifiers are bare; try to detect oclc numbers (not prefixed)
        const bareOclc = parsed.identifiers.find((x) => /^[0-9]+$/.test(x));
        if (bareOclc) idCandidates.push(`oclc:${bareOclc}`);
      }

      let hits = [];
      for (const id of idCandidates.slice(0, MAX_PER_RECORD_LOOKUPS)) {
        try {
          const json = await volumesBriefJson(id);
          const localCards = volumesToCards(json, parsed.title, parsed.creator);
          if (localCards.length) {
            hits = localCards;
            break;
          }
        } catch (e) {
          console.warn('[HathiTrust] volumes lookup failed for', id, e?.message || e);
        }
      }

      cards.push(...hits);
      if (cards.length >= limit) break;
    }

    return cards.slice(0, limit);
  } catch (err) {
    console.error('[HathiTrust] search error:', err?.message || err);
    return [];
  }
}

module.exports = { searchHathiFullView };
