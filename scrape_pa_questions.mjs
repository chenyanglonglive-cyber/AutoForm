/**
 * scrape_pa_questions.mjs
 * 
 * 采集所有 PA1-PA13 模块中每道题的完整标题文本。
 * 输出: data/pa_question_titles.json
 */

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const settings = JSON.parse(await fs.readFile(path.join(projectRoot, 'config/settings.json'), 'utf8'));
let credentials = {};
try { credentials = JSON.parse(await fs.readFile(path.join(projectRoot, '.runtime/credentials.json'), 'utf8')); } catch {}
const template = JSON.parse(await fs.readFile(path.join(projectRoot, 'data/templates/default.json'), 'utf8'));
const monitoringId = template.monitoringId;
const userDataDir = path.resolve(projectRoot, settings.amfori.browserUserDataDir);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false, slowMo: 60, viewport: { width: 1440, height: 900 },
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(60000);

try {
  // Login & Navigate
  console.log('[1] Navigating...');
  await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
  const needsLogin = await page.locator("input[type='password']").first().isVisible({ timeout: 5000 }).catch(() => false);
  if (needsLogin) {
    console.log('[2] Logging in...');
    await page.locator(settings.login.usernameSelector).first().fill(credentials.username || '');
    await page.locator("input[type='password']").first().fill(credentials.password || '');
    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: 30000 }),
      page.locator(settings.login.submitSelector).first().click(),
    ]);
    await page.waitForFunction(() => !document.querySelector("input[type='password']"), null, { timeout: 60000 });
    await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
  }

  // Open project
  await page.waitForLoadState('networkidle').catch(() => {});
  const idLoc = page.getByText(monitoringId, { exact: true }).first();
  await idLoc.waitFor({ state: 'visible', timeout: 30000 });
  await Promise.allSettled([page.waitForLoadState('domcontentloaded'), idLoc.click()]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  // Navigate to Report index
  const reportHref = await page.evaluate(() => {
    for (const a of document.querySelectorAll('a[href*="report-sections"]')) {
      if (a.textContent.trim().match(/^Report$/i) || a.href.endsWith('report-sections')) return a.href;
    }
    for (const tab of document.querySelectorAll('a[role="tab"]')) {
      if (tab.textContent.trim() === 'Report' && tab.href) return tab.href;
    }
    return '';
  });
  if (reportHref) {
    await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
  } else {
    const m = page.url().match(/(.*\/monitoring-reports\/[^/]+)/);
    if (m) await page.goto(m[1] + '/report-sections', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  const reportIndexUrl = page.url();
  console.log(`Report index: ${reportIndexUrl}`);

  // PA modules are section10 (PA1) through section22 (PA13)
  // PA number mapping: section10=PA1, section11=PA2, ..., section22=PA13
  const paQuestionTitles = {};

  for (let sectionIdx = 10; sectionIdx <= 22; sectionIdx++) {
    const paNumber = sectionIdx - 9; // PA1=10-9=1, PA2=11-9=2, ...
    const sectionId = `section${sectionIdx}`;
    console.log(`\n=== PA${paNumber} (${sectionId}) ===`);

    // Go to index
    if (sectionIdx > 10) {
      await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Click section
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) el.click();
    }, sectionId);
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    // Scroll to trigger lazy rendering
    await page.evaluate(async () => {
      const delay = ms => new Promise(r => setTimeout(r, ms));
      const h = document.body.scrollHeight;
      for (let y = 0; y <= h; y += 300) { window.scrollTo(0, y); await delay(150); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1500);

    // Wait for fields
    for (let attempt = 0; attempt < 10; attempt++) {
      const count = await page.evaluate(() =>
        document.querySelectorAll('input[type="radio"]').length
      );
      if (count > 0) break;
      await page.waitForTimeout(1000);
    }

    // Extract question titles
    // Each question has a pattern like: 
    //   Text: "1.1 Is there satisfactory evidence..."
    //   followed by radio buttons with id: MAN_PA1_1-yes, etc.
    // The question title is typically in a <div> or <p> or text node right before the radio group
    const questions = await page.evaluate((paN) => {
      const result = {};
      
      // Strategy 1: Find all elements that contain question text patterns like "X.Y ..."
      const regex = new RegExp(`^${paN}\\.\\d+\\s+`);
      const allElements = document.querySelectorAll('*');
      
      for (const el of allElements) {
        // Only check leaf-ish elements (elements with direct text)
        if (el.children.length > 3) continue;
        const text = el.textContent.trim();
        if (!text || text.length < 20 || text.length > 500) continue;
        
        const match = text.match(new RegExp(`^(${paN})\\.(\\d+)\\s+(.+?)\\s*\\*?$`, 's'));
        if (match) {
          const qNum = parseInt(match[2]);
          const qText = match[3].trim()
            .replace(/\s+/g, ' ')  // normalize whitespace
            .replace(/\*$/, '')     // remove trailing asterisk
            .trim();
          
          // Only store if we haven't found a better (shorter, more specific) match
          if (!result[qNum] || qText.length < result[qNum].length) {
            result[qNum] = qText;
          }
        }
      }

      // Strategy 2: Look for labels/divs that are immediate predecessors of radio groups
      // Find radio buttons with MAN_PA{N}_ pattern
      const radios = document.querySelectorAll(`input[id^="MAN_PA${paN}_"][id$="-yes"]`);
      for (const radio of radios) {
        const idMatch = radio.id.match(/MAN_PA\d+_(\d+)-yes/);
        if (!idMatch) continue;
        const qNum = parseInt(idMatch[1]);
        if (result[qNum]) continue; // already found

        // Walk up from the radio to find the question text
        let container = radio.parentElement;
        for (let i = 0; i < 8 && container; i++) {
          // Look for text content that starts with PA.Q pattern
          const textNodes = [];
          for (const child of container.childNodes) {
            if (child.nodeType === 3) textNodes.push(child.textContent.trim());
          }
          
          // Check child elements for question text
          for (const child of container.children) {
            const ct = child.textContent.trim();
            const m2 = ct.match(new RegExp(`^${paN}\\.${qNum}\\s+(.+?)\\s*\\*?$`, 's'));
            if (m2 && m2[1].length > 15) {
              result[qNum] = m2[1].replace(/\s+/g, ' ').replace(/\*$/, '').trim();
              break;
            }
          }
          if (result[qNum]) break;
          container = container.parentElement;
        }
      }

      return result;
    }, paNumber);

    paQuestionTitles[paNumber] = questions;
    const count = Object.keys(questions).length;
    console.log(`  Found ${count} question titles:`);
    for (const [num, text] of Object.entries(questions).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
      console.log(`    ${paNumber}.${num}: ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);
    }
  }

  // Save results
  const outPath = path.join(projectRoot, 'data', 'pa_question_titles.json');
  await fs.writeFile(outPath, JSON.stringify(paQuestionTitles, null, 2), 'utf8');
  console.log(`\n✅ Saved to: ${outPath}`);

  // Summary
  let totalQuestions = 0;
  for (const [pa, qs] of Object.entries(paQuestionTitles)) {
    totalQuestions += Object.keys(qs).length;
  }
  console.log(`Total: ${totalQuestions} question titles across ${Object.keys(paQuestionTitles).length} PA modules`);

} catch (err) {
  console.error('FATAL:', err.message);
  await page.screenshot({
    path: path.join(projectRoot, 'data', 'screenshots', `pa_titles_error_${Date.now()}.png`),
    fullPage: true,
  }).catch(() => {});
} finally {
  await context.close();
  console.log('Done.');
}
