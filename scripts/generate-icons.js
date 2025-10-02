// scripts/generate-icons.js
//
// Generate PNG icon set from public/favicon.svg so all platforms are happy.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  try {
    const pubDir = path.join(__dirname, '..', 'public');
    const svgPath = path.join(pubDir, 'favicon.svg');

    if (!fs.existsSync(svgPath)) {
      console.warn('[icons] public/favicon.svg not found — skipping icon generation.');
      process.exit(0);
    }

    const targets = [
      { out: 'favicon-16x16.png', size: 16 },
      { out: 'favicon-32x32.png', size: 32 },
      { out: 'apple-touch-icon.png', size: 180 },
      { out: 'android-chrome-192x192.png', size: 192 },
      { out: 'android-chrome-512x512.png', size: 512 }
    ];

    for (const t of targets) {
      const outPath = path.join(pubDir, t.out);
      await sharp(svgPath)
        .resize(t.size, t.size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toFile(outPath);
      console.log(`[icons] generated ${t.out}`);
    }

    console.log('[icons] all icons generated from favicon.svg');
  } catch (err) {
    console.error('[icons] generation failed:', err);
    // Do not hard-fail build; just log. The app can still run with SVG favicon.
    process.exit(0);
  }
})();
