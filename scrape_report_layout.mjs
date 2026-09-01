/**
 * scrape_report_layout.mjs
 *
 * 只读快速采集 23 个 Report 模块的页面布局（章节/分组/字段顺序/表格/单选复选分组）。
 * 不展开任何下拉 —— 下拉候选选项由 scrape_report_options.mjs 单独采集。
 *
 * 安全：登录完成后拦截并 abort 所有非 GET 请求；每模块采集完刷新回 report-sections。
 * 断点续跑：已存在非空 layout 的模块跳过；每模块完成即写文件。
 *
 * 输出（git 忽略）：
 *   data/report-layout/index.json
 *   data/report-layout/modules/<slug>.json
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
const modulesOutDir = path.join(outDir, 'modules');
await fs.mkdir(modulesOutDir, { recursive: true });

function slugify(v) { return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72); }
function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); })]).finally(() => clearTimeout(t));
}

const context = await chromium.launchPersistentContext(userDataDir, { headless: false, slowMo: 40, viewport: { width: 1440, height: 900 } });
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(25000);
page.on('dialog', (d) => d.dismiss().catch(() => {}));

// ===== 登录 =====
await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);
const hasPwd = await page.evaluate(() => !!document.querySelector("input[type='password']"));
console.log(`[1] login: ${hasPwd ? 'password field present' : 'already authenticated'}`);
if (hasPwd) {
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
console.log('  (write requests blocked)');

// ===== 打开项目 =====
console.log(`[2] open project ${monitoringId}`);
await page.waitForLoadState('networkidle').catch(() => {});
const idLoc = page.getByText(monitoringId, { exact: true }).first();
await idLoc.waitFor({ state: 'visible', timeout: 30000 });
await Promise.allSettled([page.waitForLoadState('domcontentloaded'), idLoc.click()]);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('a[role="tab"], a[href*="report-sections"]').length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);

// ===== 进入 report-sections =====
console.log('[3] find report-sections link');
const reportHref = await page.evaluate(() => { const a = document.querySelector('a[href*="report-sections"]'); return a ? a.href : ''; });
if (!reportHref) throw new Error('report-sections link not found');
await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('a.js-open-section').length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
const reportIndexUrl = page.url();
console.log(`    report index: ${reportIndexUrl}`);

const moduleIndex = await page.evaluate(() =>
  [...document.querySelectorAll('a.js-open-section')].map((a, i) => ({ sectionId: a.id || `section${i}`, title: (a.textContent || '').trim().replace(/\s+/g, ' ') }))
);
console.log(`[4] ${moduleIndex.length} modules found`);

// ===== 布局采集（evaluate 内自包含，不展开下拉）=====
const LAYOUT_FN = () => {
  const typeOf = (el) => (typeof el.className === 'string' ? el.className.match(/form-field-type-(\w+)/)?.[1] : '') || '';
  const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
  const tables = [...document.querySelectorAll('table')];
  const tableIndexByEl = new Map(tables.map((t, i) => [t, i]));
  const uiSelectInputs = [...document.querySelectorAll('input.ui-select-search')];
  const uiSelectIndexByInput = new Map(uiSelectInputs.map((el, i) => [el, i]));

  // 在给定作用域内按 DOM 顺序采集字段引用：有 id 的普通字段记 { id }，无 id 的 ui-select 记 { uiSelectIndex }。
  // 跳过 focusser-* 聚焦辅助控件与 hidden/file/submit/button。
  function fieldRefsWithin(scope) {
    const refs = [];
    for (const inp of scope.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, select')) {
      if (inp.classList.contains('ui-select-search')) {
        const idx = uiSelectIndexByInput.get(inp);
        if (idx != null) refs.push({ uiSelectIndex: idx });
        continue;
      }
      const id = inp.id || inp.name || '';
      if (id && !id.startsWith('focusser-')) refs.push({ id });
    }
    return refs;
  }

  function collect(el) {
    const blocks = [];
    for (const child of el.children) {
      const type = typeOf(child);
      if (!type) { blocks.push(...collect(child)); continue; }
      if (type === 'panel') {
        const title = text(child.querySelector('.panel-heading, .panel-title'));
        const body = child.querySelector('.panel-body') || child;
        blocks.push({ type: 'group', title, collapsed: false, children: collect(body) });
      } else if (['columns', 'fieldset', 'container', 'well'].includes(type)) {
        blocks.push(...collect(child));
      } else if (type === 'htmlelement' || type === 'content') {
        const t = text(child);
        if (t) blocks.push({ type: 'help', text: t });
      } else if (type === 'datagrid' || type === 'editgrid' || type === 'table') {
        const tbl = child.querySelector('table');
        const title = text(child.querySelector('.panel-heading, .panel-title, legend'));
        if (!tbl) { blocks.push({ type: 'table', index: null, title, headers: [], rowCount: 0, rows: [] }); continue; }
        const headers = [...tbl.querySelectorAll('thead th')].map((th) => text(th));
        const body = tbl.querySelector('tbody') || tbl;
        const rawRows = [...body.querySelectorAll(':scope > tr')];
        // 每行按 DOM 顺序采集字段引用，跨行对齐列；嵌套 table 内部的字段会被 fieldRefsWithin 一并拍平。
        const rows = rawRows.map((tr) => fieldRefsWithin(tr)).filter((r) => r.length > 0);
        blocks.push({ type: 'table', index: tableIndexByEl.get(tbl), title, headers, rowCount: rawRows.length, rows });
      } else if (type === 'radio' || type === 'checkbox' || type === 'selectboxes') {
        // selectboxes 是 Form.io 的多选框组，渲染为多个 checkbox（id 形如 <key>-<value>），按 checkbox 组采集。
        const controlType = type === 'selectboxes' ? 'checkbox' : type;
        const optionKeys = [...child.querySelectorAll(`input[type="${controlType}"]`)].map((i) => i.id || i.name || '').filter(Boolean);
        blocks.push({ type: 'field-group', controlType, label: text(child.querySelector('label.control-label, legend')) || '', optionKeys });
      } else if (type.startsWith('select')) {
        // select / selectcurrency / selectresource 等：内部要么是 ui-select 搜索框，要么是原生 <select>。
        const uiSearch = child.querySelector('input.ui-select-search');
        if (uiSearch) blocks.push({
          type: 'field',
          uiSelectIndex: uiSelectIndexByInput.get(uiSearch),
          label: text(child.querySelector('label.control-label, label'))
        });
        else { const sel = child.querySelector('select'); blocks.push({ type: 'field', id: sel?.id || sel?.name || '' }); }
      } else {
        const subs = [...child.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select')];
        for (const s of subs) blocks.push({ type: 'field', id: s.id || s.name || '' });
      }
    }
    return blocks;
  }
  const blocks = collect(document.body);
  return { blocks, uiSelectCount: uiSelectInputs.length, tableCount: tables.length };
};

async function collectOneModuleLayout(mi, sectionId, slug, title) {
  if (mi > 0) {
    await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('a.js-open-section').length > 0, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await page.evaluate((id) => document.getElementById(id)?.click(), sectionId);
  await page.waitForTimeout(1000);
  let fieldCount = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    fieldCount = await page.evaluate(() => document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select').length);
    if (fieldCount > 0) break;
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  const layoutResult = await page.evaluate(LAYOUT_FN);
  return { layout: layoutResult.blocks, uiSelectCount: layoutResult.uiSelectCount, tableCount: layoutResult.tableCount, fieldCount };
}

// ===== 逐模块采集（断点续跑：已有非空 layout 的模块跳过）=====
const indexEntries = [];
for (let mi = 0; mi < moduleIndex.length; mi++) {
  const { sectionId, title } = moduleIndex[mi];
  const slug = `${String(mi + 1).padStart(2, '0')}-${slugify(title)}`;
  const filePath = path.join(modulesOutDir, `${slug}.json`);

  // 断点续跑：已有非空 layout 则跳过
  try {
    const existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (Array.isArray(existing.layout) && existing.layout.length > 0) {
      indexEntries.push({ id: slug, title, file: `modules/${slug}.json`, blockCount: existing.layout.length, uiSelectCount: existing.uiSelectCount ?? 0, skipped: true });
      console.log(`\n===== [${mi + 1}/${moduleIndex.length}] ${slug} (cached, skip) =====`);
      continue;
    }
  } catch {}

  console.log(`\n===== [${mi + 1}/${moduleIndex.length}] ${slug} =====`);
  let moduleOut = { id: slug, title, layout: [] };
  try {
    const result = await withTimeout(collectOneModuleLayout(mi, sectionId, slug, title), 120000, slug);
    moduleOut = { id: slug, title, layout: result.layout, uiSelectCount: result.uiSelectCount, tableCount: result.tableCount };
    await fs.writeFile(filePath, `${JSON.stringify(moduleOut, null, 2)}\n`, 'utf8');
    console.log(`    fields=${result.fieldCount} blocks=${result.layout.length} tables=${result.tableCount} ui-select=${result.uiSelectCount}`);
  } catch (err) {
    console.error(`    ERROR: ${err.message}`);
    await fs.writeFile(filePath, `${JSON.stringify(moduleOut, null, 2)}\n`, 'utf8');
  }

  indexEntries.push({ id: slug, title, file: `modules/${slug}.json`, blockCount: moduleOut.layout.length, uiSelectCount: moduleOut.uiSelectCount ?? 0 });
}

await fs.writeFile(path.join(outDir, 'index.json'), `${JSON.stringify({ version: 1, monitoringId, modules: indexEntries }, null, 2)}\n`, 'utf8');
console.log(`\nDone. Layout saved to data/report-layout/ (${indexEntries.length} modules).`);
await context.close();
