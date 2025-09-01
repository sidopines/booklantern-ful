#!/usr/bin/env node
// scripts/check-gutenberg.js
// Quick verification script for Gutenberg resolver

const { resolveGutenbergEpubUrl } = require('../connectors/gutenberg');

async function checkGutenberg(gid) {
  try {
    console.log(`\nChecking Gutenberg ID: ${gid}`);
    
    // Try images variant first
    const imagesUrl = await resolveGutenbergEpubUrl(gid, { preferImages: true });
    if (imagesUrl) {
      console.log(`✅ Images variant: ${imagesUrl}`);
    } else {
      console.log(`❌ Images variant: failed`);
      
      // Try no-images variant
      const noImagesUrl = await resolveGutenbergEpubUrl(gid, { preferImages: false });
      if (noImagesUrl) {
        console.log(`✅ No-images variant: ${noImagesUrl}`);
      } else {
        console.log(`❌ No-images variant: failed`);
      }
    }
  } catch (error) {
    console.error(`❌ Error checking ${gid}:`, error.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node scripts/check-gutenberg.js <gid1> <gid2> ...');
    console.log('Example: node scripts/check-gutenberg.js 1497 15784 48013');
    process.exit(1);
  }
  
  console.log('Gutenberg Resolver Test');
  console.log('=======================');
  
  for (const gid of args) {
    await checkGutenberg(gid);
  }
  
  console.log('\nDone!');
}

if (require.main === module) {
  main().catch(console.error);
}
