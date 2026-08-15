/**
 * scrape_report_v3.mjs
 *
 * 利用 a.js-open-section#sectionN 逐个进入 23 个 Report 模块,
 * 采集每个模块的所有表单字段、select 选项、表格结构。
 * 输出 data/report_schema.json
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

const ssDir = path.join(projectRoot, 'data', 'screenshots');
await fs.mkdir(ssDir, { recursive: true });

try {
  // ===== Login & Navigate =====
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

  // ===== Open Project =====
  console.log(`[3] Opening project ${monitoringId}...`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const idLoc = page.getByText(monitoringId, { exact: true }).first();
  await idLoc.waitFor({ state: 'visible', timeout: 30000 });
  await Promise.allSettled([page.waitForLoadState('domcontentloaded'), idLoc.click()]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  console.log(`  After project click URL: ${page.url()}`);

  // ===== Navigate to Report Tab =====
  console.log('[4] Finding Report tab...');

  // Strategy 1: Find the Report tab link by looking for an <a> with href containing "report-sections"
  let reportIndexUrl = '';
  
  const reportHref = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="report-sections"]');
    for (const a of links) {
      if (a.textContent.trim().match(/^Report$/i) || a.href.endsWith('report-sections')) {
        return a.href;
      }
    }
    // Also check all tab links
    const tabs = document.querySelectorAll('[role="tab"] a, a[role="tab"]');
    for (const tab of tabs) {
      if (tab.textContent.trim() === 'Report' && tab.href) {
        return tab.href;
      }
    }
    return '';
  });

  if (reportHref) {
    console.log(`  Found report link: ${reportHref}`);
    await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    reportIndexUrl = page.url();
  }

  // Strategy 2: If still not on report-sections, try clicking Report tab by various selectors
  if (!page.url().includes('report-sections')) {
    console.log('  Strategy 1 failed. Trying tab click...');
    
    // Try multiple selectors for the Report tab
    const tabSelectors = [
      '[id="tab-monitoring.report"]',
      'a[role="tab"]:has-text("Report")',
      'a:has(span:text-is("Report"))',
    ];
    
    for (const sel of tabSelectors) {
      try {
        const tab = page.locator(sel).first();
        if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`  Clicking tab with selector: ${sel}`);
          await tab.click();
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(2000);
          if (page.url().includes('report-sections')) break;
        }
      } catch {}
    }
    reportIndexUrl = page.url();
  }

  // Strategy 3: Construct URL from the current URL pattern
  if (!page.url().includes('report-sections')) {
    console.log('  Strategy 2 failed. Constructing URL from pattern...');
    const currentUrl = page.url();
    // Look for monitoring-reports/XXX pattern and append report-sections
    const match = currentUrl.match(/(.*\/monitoring-reports\/[^/]+)/);
    if (match) {
      reportIndexUrl = match[1] + '/report-sections';
    } else {
      // Try to find it from any link on the page
      const allReportLinks = await page.evaluate(() => {
        return [...document.querySelectorAll('a[href]')]
          .map(a => a.href)
          .filter(h => h.includes('report-sections'));
      });
      if (allReportLinks.length > 0) {
        reportIndexUrl = allReportLinks[0];
      }
    }
    
    if (reportIndexUrl && !page.url().includes('report-sections')) {
      console.log(`  Navigating directly to: ${reportIndexUrl}`);
      await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

  // Final check
  if (!page.url().includes('report-sections')) {
    throw new Error(`Failed to navigate to Report sections. Current URL: ${page.url()}`);
  }
  
  reportIndexUrl = page.url();
  console.log(`[4] Report index: ${reportIndexUrl}`);

  // ===== Discover Module Count =====
  const moduleCount = await page.evaluate(() => {
    return document.querySelectorAll('a.js-open-section').length;
  });
  console.log(`Found ${moduleCount} module sections.`);

  // Also get module names from index page
  const moduleIndex = await page.evaluate(() => {
    const items = [];
    const links = document.querySelectorAll('a.js-open-section');
    links.forEach((a) => {
      items.push({
        id: a.id,
        text: a.textContent.trim().replace(/\s+/g, ' '),
      });
    });
    return items;
  });
  console.log('Module index:', moduleIndex.map((m, i) => `${i}: ${m.text}`).join('\n  '));

  // ===== Scrape Each Module =====
  const schema = {
    scrapedAt: new Date().toISOString(),
    monitoringId,
    reportIndexUrl,
    moduleCount,
    modules: [],
  };

  for (let i = 0; i < moduleCount; i++) {
    const sectionId = `section${i}`;
    const moduleName = moduleIndex[i]?.text || `Section ${i}`;
    console.log(`\n===== [${i + 1}/${moduleCount}] ${moduleName} =====`);

    try {
      // Always navigate back to index page for a clean state
      if (i > 0) {
        await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        // Verify the section links are present
        await page.waitForFunction(
          () => document.querySelectorAll('a.js-open-section').length > 0,
          null, { timeout: 10000 }
        ).catch(() => {});
      }

      // Click the module link via JavaScript (more reliable for Angular)
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (el) el.click();
      }, sectionId);

      // Wait for Angular to route and begin rendering
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1000);

      const moduleUrl = page.url();
      console.log(`  URL: ${moduleUrl}`);

      // Scroll the entire page incrementally to trigger Angular lazy rendering
      await page.evaluate(async () => {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        const totalHeight = document.body.scrollHeight;
        const step = Math.max(300, Math.floor(totalHeight / 10));
        for (let y = 0; y <= totalHeight; y += step) {
          window.scrollTo(0, y);
          await delay(200);
        }
        window.scrollTo(0, 0); // scroll back to top
      });
      await page.waitForTimeout(1500);

      // Poll for fields to appear (Angular dynamic rendering)
      let fieldCount = 0;
      for (let attempt = 0; attempt < 10; attempt++) {
        fieldCount = await page.evaluate(() => {
          return document.querySelectorAll(
            'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select'
          ).length;
        });
        if (fieldCount > 0) break;
        await page.waitForTimeout(1000);
      }
      console.log(`  Detected ${fieldCount} fields after wait.`);
      const moduleData = await page.evaluate((mName) => {
        const result = {
          title: mName,
          url: window.location.href,
          sections: [],
          fields: [],
          tables: [],
        };

        // Section headings
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, .section-title');
        for (const h of headings) {
          const text = h.textContent.trim();
          if (text && text.length > 1 && text.length < 150) {
            result.sections.push(text);
          }
        }

        // All form elements
        const inputs = document.querySelectorAll(
          'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), ' +
          'textarea, select'
        );

        for (const el of inputs) {
          const tagName = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || tagName;
          const name = el.name || '';
          const id = el.id || '';
          const placeholder = el.placeholder || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const ngModel = el.getAttribute('ng-model') || el.getAttribute('formcontrolname') || '';

          // Multi-strategy label detection
          let labelText = '';
          // 1. label[for]
          if (id) {
            try {
              const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
              if (lbl) labelText = lbl.textContent.trim();
            } catch {}
          }
          // 2. closest label
          if (!labelText) {
            const cl = el.closest('label');
            if (cl) {
              // Get label text excluding the input's own text
              const clone = cl.cloneNode(true);
              const childInputs = clone.querySelectorAll('input, select, textarea');
              childInputs.forEach(ci => ci.remove());
              labelText = clone.textContent.trim();
            }
          }
          // 3. Previous sibling label
          if (!labelText) {
            let sib = el.previousElementSibling;
            for (let j = 0; j < 5 && sib; j++) {
              if (sib.tagName === 'LABEL') {
                labelText = sib.textContent.trim();
                break;
              }
              sib = sib.previousElementSibling;
            }
          }
          // 4. Parent container label
          if (!labelText) {
            let parent = el.parentElement;
            for (let j = 0; j < 6 && parent; j++) {
              const lbl = parent.querySelector('label, .control-label, .form-label, [class*="label"]');
              if (lbl && !lbl.contains(el)) {
                labelText = lbl.textContent.trim();
                break;
              }
              parent = parent.parentElement;
            }
          }
          // 5. Table header for inputs inside table cells
          if (!labelText) {
            const td = el.closest('td');
            if (td) {
              const cellIndex = td.cellIndex;
              const table = td.closest('table');
              if (table && cellIndex >= 0) {
                const th = table.querySelector(`thead th:nth-child(${cellIndex + 1})`);
                if (th) labelText = th.textContent.trim();
              }
            }
          }

          // Build CSS selector
          let selector = '';
          if (id) selector = `#${CSS.escape(id)}`;
          else if (name) selector = `${tagName}[name="${name}"]`;

          // Fallback xpath
          let xpathFallback = '';
          const displayLabel = labelText || ariaLabel || placeholder;
          if (displayLabel && displayLabel.length < 80) {
            xpathFallback = `xpath=(//*[contains(normalize-space(),'${displayLabel.substring(0, 40).replace(/'/g, "\\'")}']/following::${tagName})[1]`;
          }

          // Select/dropdown options
          let options = [];
          if (tagName === 'select') {
            options = [...el.options].map(o => ({
              value: o.value,
              label: o.textContent.trim(),
              selected: o.selected,
            }));
          }

          // Checkbox/Radio group
          let groupValues = [];
          if ((type === 'radio' || type === 'checkbox') && name) {
            const group = document.querySelectorAll(`input[name="${name}"]`);
            groupValues = [...group].map(r => {
              let rLabel = '';
              const rParent = r.parentElement;
              if (rParent) {
                const clone = rParent.cloneNode(true);
                clone.querySelectorAll('input').forEach(ci => ci.remove());
                rLabel = clone.textContent.trim();
              }
              return { value: r.value, label: rLabel, checked: r.checked };
            });
          }

          const rect = el.getBoundingClientRect();

          result.fields.push({
            tagName, type, name, id,
            labelText: labelText || ariaLabel || placeholder || '',
            ariaLabel, placeholder, ngModel,
            selector, xpathFallback,
            required: el.required || false,
            disabled: el.disabled || false,
            readOnly: el.readOnly || false,
            value: el.value || '',
            options, groupValues,
            isVisible: rect.width > 0 && rect.height > 0,
            boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            outerHTML: el.outerHTML.substring(0, 600),
          });
        }

        // Tables
        const tableEls = document.querySelectorAll('table');
        for (const tbl of tableEls) {
          const headers = [...tbl.querySelectorAll('thead th, thead td')].map(th => th.textContent.trim());
          const bodyRows = tbl.querySelectorAll('tbody tr');
          const sampleRows = [];
          for (let r = 0; r < Math.min(bodyRows.length, 3); r++) {
            const cells = [...bodyRows[r].querySelectorAll('td')].map(td => {
              const inp = td.querySelector('input, select, textarea');
              if (inp) {
                return {
                  type: 'input',
                  inputType: inp.getAttribute('type') || inp.tagName.toLowerCase(),
                  name: inp.name || '', id: inp.id || '',
                };
              }
              return { type: 'text', value: td.textContent.trim().substring(0, 100) };
            });
            sampleRows.push(cells);
          }

          result.tables.push({
            headers, rowCount: bodyRows.length,
            sampleRows,
            selector: tbl.id ? `#${CSS.escape(tbl.id)}` : '',
            className: typeof tbl.className === 'string' ? tbl.className.substring(0, 200) : '',
          });
        }

        return result;
      }, moduleName);

      moduleData.sectionId = sectionId;
      moduleData.url = moduleUrl;
      schema.modules.push(moduleData);

      // Visible fields only count
      const visibleFields = moduleData.fields.filter(f => f.isVisible);
      console.log(`  Fields: ${moduleData.fields.length} (${visibleFields.length} visible), Tables: ${moduleData.tables.length}, Sections: ${moduleData.sections.length}`);

      // Screenshot
      const safeName = moduleName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
      await page.screenshot({
        path: path.join(ssDir, `report_${String(i + 1).padStart(2, '0')}_${safeName}.png`),
        fullPage: true,
      });

      // Check if page needs scrolling to reveal more fields
      const pageHeight = await page.evaluate(() => document.body.scrollHeight);
      if (pageHeight > 1200) {
        // Scroll down and check for lazy-loaded fields
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
        
        const additionalFields = await page.evaluate(() => {
          const inputs = document.querySelectorAll(
            'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select'
          );
          return inputs.length;
        });
        
        if (additionalFields > moduleData.fields.length) {
          console.log(`  (After scroll: ${additionalFields} fields total)`);
        }
      }

    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      schema.modules.push({
        sectionId: `section${i}`,
        title: moduleName,
        url: page.url(),
        error: err.message,
        fields: [], tables: [], sections: [],
      });

      // Try to go back to index
      try {
        await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
      } catch {}
    }
  }

  // ===== Save Schema =====
  const schemaPath = path.join(projectRoot, 'data', 'report_schema.json');
  await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf8');

  const totalFields = schema.modules.reduce((s, m) => s + (m.fields?.length || 0), 0);
  const totalVisibleFields = schema.modules.reduce((s, m) => s + (m.fields?.filter(f => f.isVisible)?.length || 0), 0);
  const totalTables = schema.modules.reduce((s, m) => s + (m.tables?.length || 0), 0);
  const errors = schema.modules.filter(m => m.error).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Schema saved to: ${schemaPath}`);
  console.log(`   Modules: ${schema.modules.length}`);
  console.log(`   Total fields: ${totalFields} (${totalVisibleFields} visible)`);
  console.log(`   Total tables: ${totalTables}`);
  console.log(`   Errors: ${errors}`);
  console.log(`${'='.repeat(60)}`);

  console.log('\n--- Module Summary ---');
  schema.modules.forEach((m, i) => {
    const vis = m.fields?.filter(f => f.isVisible)?.length || 0;
    const err = m.error ? ` ❌ ${m.error.substring(0, 50)}` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${m.title}: ${m.fields?.length || 0} fields (${vis} visible), ${m.tables?.length || 0} tables${err}`);
  });

} catch (err) {
  console.error('FATAL:', err.message);
  await page.screenshot({ path: path.join(ssDir, `fatal_${Date.now()}.png`), fullPage: true }).catch(() => {});
} finally {
  await context.close();
  console.log('\nBrowser closed.');
}
