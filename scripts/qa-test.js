#!/usr/bin/env node
// QA test script for cinematic gate→hall experience

const puppeteer = require('puppeteer');

const BASE_URL = process.env.BASE_URL || 'http://localhost:10000';
const TIMEOUT = 8000;

async function runQA() {
  console.log('🧪 Starting QA tests for BookLantern cinematic experience...');
  
  let browser;
  let passed = 0;
  let failed = 0;
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    // Test 1: Landing page loads with full-viewport gate
    console.log('Test 1: Landing page gate...');
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: TIMEOUT });
      
      // Check gate is visible and full viewport
      const gate = await page.$('#gate');
      if (!gate) throw new Error('Gate element not found');
      
      const gateBox = await gate.boundingBox();
      const viewport = page.viewport();
      
      if (gateBox.width < viewport.width * 0.9 || gateBox.height < viewport.height * 0.9) {
        throw new Error('Gate is not full viewport');
      }
      
      // Check ENTER button is focusable
      const enterBtn = await page.$('.enter-medallion');
      if (!enterBtn) throw new Error('ENTER button not found');
      
      await enterBtn.focus();
      const focused = await page.evaluate(() => document.activeElement.classList.contains('enter-medallion'));
      if (!focused) throw new Error('ENTER button not focusable');
      
      console.log('✅ Test 1 passed: Gate loads with focusable ENTER');
      passed++;
      
    } catch (error) {
      console.log('❌ Test 1 failed:', error.message);
      failed++;
    }
    
    // Test 2: ENTER triggers hall transition
    console.log('Test 2: Hall transition...');
    try {
      // Click ENTER button
      await page.click('.enter-medallion');
      
      // Wait for hall to become visible
      await page.waitForSelector('#hall:not(.hidden)', { timeout: 3000 });
      
      // Check genre buttons are present
      const genreButtons = await page.$$('.genre-stack-btn');
      if (genreButtons.length !== 7) {
        throw new Error(`Expected 7 genre buttons, found ${genreButtons.length}`);
      }
      
      console.log('✅ Test 2 passed: Hall appears with 7 genre buttons');
      passed++;
      
    } catch (error) {
      console.log('❌ Test 2 failed:', error.message);
      failed++;
    }
    
    // Test 3: Genre click shows ≥12 books
    console.log('Test 3: Genre books...');
    try {
      // Click History genre
      await page.click('[data-genre="History"]');
      
      // Wait for modal to appear
      await page.waitForSelector('.shelf-modal:not(.hidden)', { timeout: 3000 });
      
      // Wait for books to load
      await page.waitForFunction(() => {
        const books = document.querySelectorAll('.book-card');
        return books.length >= 12;
      }, { timeout: 5000 });
      
      const bookCount = await page.$$eval('.book-card', books => books.length);
      
      if (bookCount < 12) {
        throw new Error(`Expected ≥12 books, found ${bookCount}`);
      }
      
      console.log(`✅ Test 3 passed: History genre shows ${bookCount} books`);
      passed++;
      
    } catch (error) {
      console.log('❌ Test 3 failed:', error.message);
      failed++;
    }
    
    // Test 4: Read button opens reader
    console.log('Test 4: Reader opens...');
    try {
      // Click first Read button
      const readBtn = await page.$('.btn-read');
      if (!readBtn) throw new Error('Read button not found');
      
      // Get the href to test
      const href = await page.$eval('.book-card[data-href]', el => el.dataset.href);
      
      if (!href || href === '#') {
        throw new Error('Book has no valid href');
      }
      
      // Navigate to reader page
      await page.goto(BASE_URL + href, { waitUntil: 'networkidle0', timeout: TIMEOUT });
      
      // Check reader page loads
      const readerEl = await page.$('[data-page="reader"]');
      if (!readerEl) throw new Error('Reader page not detected');
      
      // Wait for title to appear (within 8 seconds)
      await page.waitForFunction(() => {
        const status = document.querySelector('#status');
        return status && (status.textContent === 'ready' || status.textContent.includes('loading'));
      }, { timeout: 8000 });
      
      console.log('✅ Test 4 passed: Reader opens successfully');
      passed++;
      
    } catch (error) {
      console.log('❌ Test 4 failed:', error.message);
      failed++;
    }
    
    // Test 5: Scene endpoint reports correctly
    console.log('Test 5: Scene endpoint...');
    try {
      const response = await page.goto(BASE_URL + '/__scene', { waitUntil: 'networkidle0' });
      const sceneData = await response.json();
      
      if (!sceneData.mode || !sceneData.page) {
        throw new Error('Scene data incomplete');
      }
      
      if (!['webgl', 'video', 'lottie', 'svg', 'fallback'].includes(sceneData.mode)) {
        throw new Error(`Invalid mode: ${sceneData.mode}`);
      }
      
      console.log(`✅ Test 5 passed: Scene reports mode="${sceneData.mode}" page="${sceneData.page}"`);
      passed++;
      
    } catch (error) {
      console.log('❌ Test 5 failed:', error.message);
      failed++;
    }
    
  } catch (error) {
    console.error('🔥 Critical error:', error);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  // Summary
  console.log('\n📋 QA Test Summary:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Success rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! Ready for production.');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Please fix before deploying.');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runQA().catch(console.error);
}

module.exports = { runQA };
