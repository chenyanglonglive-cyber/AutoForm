// probe_datagrid2.mjs — 临时诊断：dump 模块 8 datagrid 的 outerHTML 及 text 字段真实位置。
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

await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('a.js-open-section').length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(900);
await page.evaluate((id) => document.getElementById(id)?.click(), moduleIndex[7].id); // module 8
await page.waitForTimeout(1000);
for (let a = 0; a < 12; a++) {
  const n = await page.evaluate(() => document.querySelectorAll('input:not([type="hidden"])').length);
  if (n > 0) break;
  await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
  await page.waitForTimeout(800);
}
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const out = {};
  // 1) 定位 SampledWorkerName/Department 等 text 字段在哪
  for (const id of ['SampledWorkerName-0-0', 'SampledWorkerDepartment-0-0', 'SampledWorkerEmployedSince-0-0-day', 'SampledWorkerComments-0-0']) {
    const el = document.getElementById(id);
    out[id] = el ? { found: true, inTable: !!el.closest('table'), tag: el.tagName, type: el.type, containerCls: (el.closest('[class*="form-field-type"]')?.className || '').slice(0, 60) } : { found: false };
  }
  // 2) datagrid 表头/第一行 outerHTML
  const dg = document.querySelector('.form-field-type-datagrid');
  if (dg) {
    const tbl = dg.querySelector('table');
    out.datagridHtml = (tbl ? tbl.outerHTML : dg.outerHTML).slice(0, 4000);
  }
  // 3) ui-select 数量与所在容器
  out.uiSelectCount = document.querySelectorAll('input.ui-select-search').length;
  return out;
});
console.log(JSON.stringify(info, null, 2));
await context.close();
