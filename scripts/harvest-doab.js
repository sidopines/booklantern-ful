#!/usr/bin/env node
// scripts/harvest-doab.js
// Harvests open-access book metadata from DOAB via OAI-PMH
// Usage: node scripts/harvest-doab.js
// Set HARVEST_MAX_PAGES=N to limit pages for testing

require('dotenv').config();

const https = require('https');
const http = require('http');

// Lazy-load supabaseServer to allow syntax check without env vars
let supabaseServer = null;
function getSupabase() {
  if (!supabaseServer) {
    supabaseServer = require('../lib/supabaseServer');
  }
  return supabaseServer;
}

// DOAB OAI-PMH endpoint
const OAI_BASE_URL = 'https://directory.doabooks.org/oai/request';
const METADATA_PREFIX = 'oai_dc';
const SOURCE_NAME = 'doab';

// Rate limiting: delay between requests (ms)
const REQUEST_DELAY_MS = 300;

// Max pages for testing (0 = unlimited)
const MAX_PAGES = parseInt(process.env.HARVEST_MAX_PAGES || '0', 10);

// Simple XML parser using regex (lightweight, no external dependency)
// For production, consider fast-xml-parser if complex XML is needed
function parseXML(xml) {
  const records = [];
  
  // Extract all <record> elements
  const recordRegex = /<record[^>]*>([\s\S]*?)<\/record>/gi;
  let recordMatch;
  
  while ((recordMatch = recordRegex.exec(xml)) !== null) {
    const recordXml = recordMatch[1];
    
    // Check if deleted
    if (/<header[^>]*status\s*=\s*["']deleted["']/i.test(recordXml)) {
      continue;
    }
    
    // Extract identifier from header
    const identifierMatch = /<identifier>([^<]+)<\/identifier>/i.exec(recordXml);
    const identifier = identifierMatch ? identifierMatch[1].trim() : null;
    
    if (!identifier) continue;
    
    // Extract DC metadata
    const metadata = {};
    
    // dc:title
    const titleMatch = /<dc:title[^>]*>([^<]+)<\/dc:title>/i.exec(recordXml);
    metadata.title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null;
    
    // dc:creator (multiple)
    const creators = [];
    const creatorRegex = /<dc:creator[^>]*>([^<]+)<\/dc:creator>/gi;
    let creatorMatch;
    while ((creatorMatch = creatorRegex.exec(recordXml)) !== null) {
      creators.push(decodeEntities(creatorMatch[1].trim()));
    }
    metadata.authors = creators.join('; ');
    
    // dc:subject (multiple)
    const subjects = [];
    const subjectRegex = /<dc:subject[^>]*>([^<]+)<\/dc:subject>/gi;
    let subjectMatch;
    while ((subjectMatch = subjectRegex.exec(recordXml)) !== null) {
      subjects.push(decodeEntities(subjectMatch[1].trim()));
    }
    metadata.subjects = subjects.join('; ');
    
    // dc:language
    const langMatch = /<dc:language[^>]*>([^<]+)<\/dc:language>/i.exec(recordXml);
    metadata.language = langMatch ? langMatch[1].trim().toLowerCase() : null;
    
    // dc:description (first one, truncated)
    const descMatch = /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i.exec(recordXml);
    if (descMatch) {
      let desc = decodeEntities(descMatch[1].trim());
      if (desc.length > 2000) {
        desc = desc.substring(0, 2000) + '...';
      }
      metadata.description = desc;
    }
    
    // dc:date (extract year)
    const dateMatch = /<dc:date[^>]*>([^<]+)<\/dc:date>/i.exec(recordXml);
    if (dateMatch) {
      const yearMatch = /(\d{4})/.exec(dateMatch[1]);
      metadata.published_year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    }
    
    // dc:identifier (look for URL)
    const identifiers = [];
    const idRegex = /<dc:identifier[^>]*>([^<]+)<\/dc:identifier>/gi;
    let idMatch;
    while ((idMatch = idRegex.exec(recordXml)) !== null) {
      identifiers.push(idMatch[1].trim());
    }
    
    // Find source URL (prefer https:// URL, then http://)
    const sourceUrl = identifiers.find(id => id.startsWith('https://')) ||
                      identifiers.find(id => id.startsWith('http://')) ||
                      null;
    metadata.source_url = sourceUrl;
    
    records.push({
      source_id: identifier,
      ...metadata,
    });
  }
  
  // Extract resumptionToken
  const tokenMatch = /<resumptionToken[^>]*>([^<]*)<\/resumptionToken>/i.exec(xml);
  const resumptionToken = tokenMatch ? tokenMatch[1].trim() : null;
  
  return { records, resumptionToken };
}

// Decode common XML entities
function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// Fetch URL with timeout
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Upsert records to Supabase
async function upsertRecords(records) {
  if (records.length === 0) return 0;
  
  const supabase = getSupabase();
  
  const rows = records.map(r => ({
    source: SOURCE_NAME,
    source_id: r.source_id,
    title: r.title || null,
    authors: r.authors || null,
    language: r.language || null,
    published_year: r.published_year || null,
    subjects: r.subjects || null,
    description: r.description || null,
    source_url: r.source_url || null,
    open_access: true,
    updated_at: new Date().toISOString(),
  }));
  
  const { error } = await supabase
    .from('catalog_books')
    .upsert(rows, { 
      onConflict: 'source,source_id',
      ignoreDuplicates: false 
    });
  
  if (error) {
    console.error('[harvest] Upsert error:', error.message);
    throw error;
  }
  
  return rows.length;
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main harvest function
async function harvest() {
  console.log('[harvest-doab] Starting DOAB OAI-PMH harvest...');
  console.log(`[harvest-doab] OAI endpoint: ${OAI_BASE_URL}`);
  console.log(`[harvest-doab] Metadata prefix: ${METADATA_PREFIX}`);
  if (MAX_PAGES > 0) {
    console.log(`[harvest-doab] Max pages: ${MAX_PAGES} (testing mode)`);
  }
  
  let resumptionToken = null;
  let pageCount = 0;
  let totalRecords = 0;
  let totalUpserted = 0;
  const startTime = Date.now();
  
  try {
    do {
      pageCount++;
      
      // Build OAI request URL
      let url;
      if (resumptionToken) {
        url = `${OAI_BASE_URL}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
      } else {
        url = `${OAI_BASE_URL}?verb=ListRecords&metadataPrefix=${METADATA_PREFIX}`;
      }
      
      console.log(`[harvest-doab] Fetching page ${pageCount}...`);
      
      const xml = await fetchUrl(url);
      
      // Check for OAI errors
      if (xml.includes('<error')) {
        const errorMatch = /<error[^>]*code=["']([^"']+)["'][^>]*>([^<]*)<\/error>/i.exec(xml);
        if (errorMatch) {
          const [, code, msg] = errorMatch;
          if (code === 'noRecordsMatch') {
            console.log('[harvest-doab] No records match the request');
            break;
          }
          throw new Error(`OAI Error ${code}: ${msg}`);
        }
      }
      
      const { records, resumptionToken: nextToken } = parseXML(xml);
      
      console.log(`[harvest-doab] Page ${pageCount}: ${records.length} records`);
      totalRecords += records.length;
      
      // Upsert to database
      if (records.length > 0) {
        const upserted = await upsertRecords(records);
        totalUpserted += upserted;
        console.log(`[harvest-doab] Upserted ${upserted} records`);
      }
      
      resumptionToken = nextToken;
      
      // Check max pages limit
      if (MAX_PAGES > 0 && pageCount >= MAX_PAGES) {
        console.log(`[harvest-doab] Reached max pages limit (${MAX_PAGES})`);
        break;
      }
      
      // Rate limiting
      if (resumptionToken) {
        await sleep(REQUEST_DELAY_MS);
      }
      
    } while (resumptionToken);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('[harvest-doab] ========================================');
    console.log(`[harvest-doab] Harvest complete!`);
    console.log(`[harvest-doab] Pages fetched: ${pageCount}`);
    console.log(`[harvest-doab] Total records processed: ${totalRecords}`);
    console.log(`[harvest-doab] Total records upserted: ${totalUpserted}`);
    console.log(`[harvest-doab] Elapsed time: ${elapsed}s`);
    console.log('[harvest-doab] ========================================');
    
  } catch (err) {
    console.error('[harvest-doab] Fatal error:', err.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  harvest().then(() => process.exit(0));
}

module.exports = { harvest };
