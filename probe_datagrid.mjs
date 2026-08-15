// probe_datagrid.mjs — 临时诊断：dump datagrid 表格 DOM 结构（表头/行/单元格/多字段单元格）。
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const settings = JSON.parse(await fs.readFile(path.join(root, 'config/settings.json'), 'utf8'));
let credentials = {};
try { credentials = JSON.parse(await fs.readFile(path.join(root, '.runtime/credentials.json'), 'utf8')); } catch {}
const template = JSON.parse(await fs.readFile(path.join(root, 'data/templates/default.json'), 'utf8'));
const monitoringId = template.monitoringId;
const userDataDir = path.resolve(root, settings.amfori.browserUserDataDir);
const targets = (process.argv[2] || '1,8').split(',').map(Number); // 模块序号

const context = await chromium.launchPersistentContext(userDataDir, { headless: false, slowMo: 30, viewport: { width: 1440, height: 900 } });
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(25000);
page.on('dialog', (d) => d.dismiss().catch(() => {}));

await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);
if (await page.evaluate(() => !!document.querySelector("input[type='password']"))) {
  await page.locator(settings.login.usernameSelector).first().fill(credentials.username || '', { timeout: 10000 });
  await page.locator("input[type='password']").first().fill(credentials.password || '', { timeout: 10000 });
  await Promise.allSettled([page.waitForLoadState('networkidle', { timeout: 25000 }), page.locator(settings.login.submitSelector).first().click({ timeout: 10000 })]);
  await page.waitForFunction(() => !document.querySelector("input[type='password']") && /monitoring-assignments\/todo/i.test(location.href), null, { timeout: 180000 });
  await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
}
await page.route('**/*', (route) => {
  const m = route.request().method();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return route.abort().catch(() => {});
  return route.continue().catch(() => {});
});

await page.getByText(monitoringId, { exact: true }).first().click();
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('a[role="tab"], a[href*="report-sections"]').length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
const reportHref = await page.evaluate(() => { const a = document.querySelector('a[href*="report-sections"]'); return a ? a.href : ''; });
await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('a.js-open-section').length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
const reportIndexUrl = page.url();
const moduleIndex = await page.evaluate(() => [...document.querySelectorAll('a.js-open-section')].map((a, i) => ({ id: a.id || `section${i}`, title: (a.textContent || '').trim() })));

for (const target of targets) {
  if (target < 1 || target > moduleIndex.length) continue;
  await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('a.js-open-section').length > 0, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate((id) => document.getElementById(id)?.click(), moduleIndex[target - 1].id);
  await page.waitForTimeout(1000);
  for (let a = 0; a < 12; a++) {
    const n = await page.evaluate(() => document.querySelectorAll('input:not([type="hidden"])').length);
    if (n > 0) break;
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  const dump = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('.form-field-type-datagrid, .form-field-type-editgrid, .form-field-type-table')];
    return tables.map((container, ti) => {
      const tbl = container.querySelector('table');
      if (!tbl) return { ti, note: 'no table' };
      const thead = tbl.querySelector('thead');
      const ths = thead ? [...thead.querySelectorAll('th')].map(th => (th.textContent || '').trim()) : [];
      const tbody = tbl.querySelector('tbody');
      const trs = tbody ? [...tbody.querySelectorAll('tr')] : [];
      return {
        ti,
        cls: container.className,
        theadPresent: !!thead,
        headers: ths,
        rowCount: trs.length,
        rows: trs.slice(0, 3).map(tr => [...tr.querySelectorAll('td')].map(td => {
          const ui = td.querySelector('input.ui-select-search');
          if (ui) return 'UISELECT';
          const inputs = [...td.querySelectorAll('input:not([type="hidden"]), textarea, select')].map(i => i.id || i.name || `(${i.tagName}:${i.type})`);
          return inputs.length ? inputs.join('+') : 'TEXT:' + (td.textContent || '').trim().slice(0, 20);
        }))
      };
    });
  });
  console.log(`\n===== module ${target}: ${moduleIndex[target - 1].title} =====`);
  console.log(JSON.stringify(dump, null, 2));
}
await context.close();
