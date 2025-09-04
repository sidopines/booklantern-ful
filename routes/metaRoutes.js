// routes/metaRoutes.js - Sitemap and robots.txt routes
const express = require('express');
const router = express.Router();

/**
 * Generate XML sitemap
 */
router.get('/sitemap.xml', (req, res) => {
  const baseUrl = process.env.BASE_URL || 'https://booklantern.org';
  
  // Static routes
  const staticRoutes = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
    { url: '/read', priority: '0.9', changefreq: 'daily' },
    { url: '/watch', priority: '0.8', changefreq: 'weekly' },
    { url: '/about', priority: '0.6', changefreq: 'monthly' },
    { url: '/contact', priority: '0.5', changefreq: 'monthly' },
    { url: '/dashboard', priority: '0.7', changefreq: 'weekly' },
    { url: '/login', priority: '0.4', changefreq: 'monthly' },
    { url: '/register', priority: '0.4', changefreq: 'monthly' }
  ];

  // Generate XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  
  staticRoutes.forEach(route => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}${route.url}</loc>\n`;
    xml += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
    xml += `    <changefreq>${route.changefreq}</changefreq>\n`;
    xml += `    <priority>${route.priority}</priority>\n`;
    xml += '  </url>\n';
  });

  // Add some canonical reader routes (template examples)
  const readerRoutes = [
    { url: '/read/gutenberg/1342/reader', priority: '0.8', changefreq: 'monthly' }, // Pride and Prejudice
    { url: '/read/gutenberg/1661/reader', priority: '0.8', changefreq: 'monthly' }, // Sherlock Holmes
    { url: '/read/gutenberg/84/reader', priority: '0.8', changefreq: 'monthly' },   // Frankenstein
    { url: '/read/gutenberg/2701/reader', priority: '0.8', changefreq: 'monthly' }, // Moby-Dick
    { url: '/read/gutenberg/11/reader', priority: '0.8', changefreq: 'monthly' }    // Alice in Wonderland
  ];

  readerRoutes.forEach(route => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}${route.url}</loc>\n`;
    xml += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
    xml += `    <changefreq>${route.changefreq}</changefreq>\n`;
    xml += `    <priority>${route.priority}</priority>\n`;
    xml += '  </url>\n';
  });

  xml += '</urlset>';

  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
  res.send(xml);
});

/**
 * Generate robots.txt
 */
router.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.BASE_URL || 'https://booklantern.org';
  
  let robots = 'User-agent: *\n';
  robots += 'Allow: /\n';
  robots += 'Disallow: /admin/\n';
  robots += 'Disallow: /api/\n';
  robots += 'Disallow: /dashboard/\n';
  robots += 'Disallow: /settings/\n';
  robots += 'Disallow: /logout\n';
  robots += 'Disallow: /login\n';
  robots += 'Disallow: /register\n';
  robots += 'Disallow: /forgot-password\n';
  robots += 'Disallow: /reset-password\n';
  robots += 'Disallow: /resend-verification\n';
  robots += '\n';
  robots += `Sitemap: ${baseUrl}/sitemap.xml\n`;

  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
  res.send(robots);
});

/**
 * Diagnostics route - list available animation assets
 */
router.get('/__assets', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const animationsDir = path.join(__dirname, '../public/animations');
    const files = fs.readdirSync(animationsDir).filter(file => file.endsWith('.json'));
    
    res.json({
      status: 'ok',
      buildId: process.env.BUILD_ID || 'dev',
      animations: files,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Animation diagnostics route - check WebGL and motion preferences
 */
router.get('/__anim', (req, res) => {
  res.json({
    status: 'ok',
    webgl: 'check client-side',
    reducedMotion: 'check client-side',
    buildId: process.env.BUILD_ID || 'dev',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
