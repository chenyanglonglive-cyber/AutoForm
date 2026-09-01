/**
 * scrape_report_options.mjs
 *
 * 只读采集 ui-select（动态下拉）候选项。按内容去重：多个控件复用同一组选项时只采集一次。
 * 优先直接读打开下拉后渲染出的 .ui-select-choices-row（静态固定列表 → complete）；
 * 打开后为空则输入 'a' 触发远程搜索（拿到部分 → partial；拿不到 → unavailable）。
 * 每个下拉硬上限 ~2.5s，超时记 unavailable，后续可单独补采。
 *
 * 安全：拦截并 abort 非 GET 写请求；每模块采集完刷新回 report-sections。
 * 断点续跑：已采集的 (module, index) 映射跳过；每模块完成即写 options.json。
 *
 * 输出（git 忽略）：data/report-layout/options.json
 *   { "version":1, "sources": { "<hash>": {status,options} }, "mapping": { "<slug>": { "<index>": "<hash>"|null } } }
 */

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readLocalTemplate } from './src/localTemplateStorage.js';

const root = process.cwd();
const settings = JSON.parse(await fs.readFile(path.join(root, 'config/settings.json'), 'utf8'));
let credentials = {};
try { credentials = JSON.parse(await fs.readFile(path.join(root, '.runtime/credentials.json'), 'utf8')); } catch {}
const template = await readLocalTemplate();
const monitoringId = template.monitoringId;
const userDataDir = path.resolve(root, settings.amfori.browserUserDataDir);

const outDir = path.join(root, 'data', 'report-layout');
const optionsPath = path.join(outDir, 'options.json');

function slugify(v) { return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72); }
function contentHash(labels) {
  const sorted = [...labels].sort();
  let h = 5381;
  for (const s of sorted) for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'src-' + h.toString(36);
}
function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); })]).finally(() => clearTimeout(t));
}

// 断点续跑：加载已采集的 sources/mapping
let store = { version: 1, sources: {}, mapping: {} };
try { store = JSON.parse(await fs.readFile(optionsPath, 'utf8')); } catch {}
store.sources ??= {};
store.mapping ??= {};
const sources = store.sources;
const mapping = store.mapping;

async function saveOptions() {
  await fs.writeFile(optionsPath, `${JSON.stringify({ version: 1, sources, mapping }, null, 2)}\n`, 'utf8');
}

const context = await chromium.launchPersistentContext(userDataDir, { headless: false, slowMo: 30, viewport: { width: 1440, height: 900 } });
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(25000);
page.on('dialog', (d) => d.dismiss().catch(() => {}));

// 登录
await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);
if (await page.evaluate(() => !!document.querySelector("input[type='password']"))) {
  await page.locator(settings.login.usernameSelector).first().fill(credentials.username || '', { timeout: 10000 });
  await page.locator("input[type='password']").first().fill(credentials.password || '', { timeout: 10000 });
  await Promise.allSettled([page.waitForLoadState('networkidle', { timeout: 25000 }), page.locator(settings.login.submitSelector).first().click({ timeout: 10000 })]);
  const gone = await page.waitForFunction(() => !document.querySelector("input[type='password']") && /monitoring-assignments\/todo/i.test(location.href), null, { timeout: settings.amfori.manualLoginTimeoutMs || 180000 }).then(() => true).catch(() => false);
  if (!gone) throw new Error('login did not complete');
  await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
}
await page.route('**/*', (route) => {
  const m = route.request().method();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return route.abort().catch(() => {});
  return route.continue().catch(() => {});
});
console.log('(write requests blocked)');

// 打开项目
console.log(`open project ${monitoringId}`);
await page.waitForLoadState('networkidle').catch(() => {});
const idLoc = page.getByText(monitoringId, { exact: true }).first();
await idLoc.waitFor({ state: 'visible', timeout: 30000 });
await Promise.allSettled([page.waitForLoadState('domcontentloaded'), idLoc.click()]);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('a[role="tab"], a[href*="report-sections"]').length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);

const reportHref = await page.evaluate(() => { const a = document.querySelector('a[href*="report-sections"]'); return a ? a.href : ''; });
if (!reportHref) throw new Error('report-sections link not found');
await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('a.js-open-section').length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
const reportIndexUrl = page.url();

const moduleIndex = await page.evaluate(() =>
  [...document.querySelectorAll('a.js-open-section')].map((a, i) => ({ sectionId: a.id || `section${i}`, title: (a.textContent || '').trim().replace(/\s+/g, ' ') }))
);
console.log(`${moduleIndex.length} modules found`);

async function readChoices(containerLocator) {
  const labels = await containerLocator.locator('.ui-select-choices-row').allTextContents();
  return labels.map((t) => (t || '').trim().replace(/\s+/g, ' ')).filter(Boolean).map((label) => ({ value: label, label }));
}

// 单个下拉：打开 → 读静态选项；空则试 'a' 远程搜索。返回 {status, options}
async function collectOneUiSelect(i) {
  const search = page.locator('input.ui-select-search').nth(i);
  const container = search.locator('xpath=ancestor::div[contains(@class,"ui-select-container")][1]');
  let status = 'unavailable', opts = [];
  try {
    await container.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    await container.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(900);
    let labels = await readChoices(container);
    if (labels.length > 0) {
      status = 'complete'; opts = labels;
    } else {
      try {
        await search.fill('a', { timeout: 1200 });
        await page.waitForTimeout(700);
        labels = await readChoices(container);
        if (labels.length > 0) { status = 'partial'; opts = labels; }
        else status = 'unavailable';
      } catch { status = 'unavailable'; }
    }
  } catch { status = 'unavailable'; }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(120);
  return { status, options: opts };
}

// 逐模块采集
for (let mi = 0; mi < moduleIndex.length; mi++) {
  const { sectionId, title } = moduleIndex[mi];
  const slug = `${String(mi + 1).padStart(2, '0')}-${slugify(title)}`;
  mapping[slug] ??= {};

  // 进入该 section
  if (mi > 0) {
    await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('a.js-open-section').length > 0, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(900);
  }
  await page.evaluate((id) => document.getElementById(id)?.click(), sectionId);
  await page.waitForTimeout(900);
  for (let a = 0; a < 14; a++) {
    const n = await page.evaluate(() => document.querySelectorAll('input.ui-select-search').length);
    if (n > 0) break;
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(300);

  const count = await page.locator('input.ui-select-search').count();
  let done = 0, skipped = 0;
  for (let i = 0; i < count; i++) {
    if (mapping[slug][String(i)] !== undefined) { skipped++; continue; }  // 断点续跑
    const r = await withTimeout(collectOneUiSelect(i), 3000, `ui-select#${i}`).catch(() => ({ status: 'unavailable', options: [] }));
    if (r.status === 'unavailable') {
      mapping[slug][String(i)] = null;
    } else {
      const key = contentHash(r.options.map((o) => o.label));
      if (!sources[key]) sources[key] = { status: r.status, options: r.options };
      mapping[slug][String(i)] = key;
    }
    done++;
  }
  await saveOptions();
  const coverage = Object.entries(mapping[slug]).reduce((acc, [, key]) => {
    if (key === null) acc.unavailable = (acc.unavailable || 0) + 1;
    else acc[sources[key]?.status || 'unknown'] = (acc[sources[key]?.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`[${mi + 1}/${moduleIndex.length}] ${slug}: ${done} collected, ${skipped} skipped, ${count} total, coverage=${JSON.stringify(coverage)}`);
}

await saveOptions();
const totalSources = Object.keys(sources).length;
const totalMapped = Object.values(mapping).reduce((s, m) => s + Object.keys(m).length, 0);
console.log(`\nDone. ${totalSources} unique option sources, ${totalMapped} ui-select controls mapped.`);
await context.close();
