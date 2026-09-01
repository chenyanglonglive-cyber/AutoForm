/**
 * scrape_report.js
 * 使用项目的持久化浏览器 profile 打开 amfori，
 * 进入 Report tab，抓取所有可交互字段的结构信息。
 *
 * 用法（在 AutoForm 项目根目录运行）：
 *   node "C:/Users/leave/.gemini/antigravity/brain/3b2a25bc-92b2-4b13-ac28-aa44e9bb051d/scratch/scrape_report.js"
 */

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalTemplate } from './src/localTemplateStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 读取项目配置 ----
const projectRoot = 'd:/AIcode-hub/AutoForm';
process.chdir(projectRoot);
const settingsRaw = await fs.readFile(path.join(projectRoot, 'config/settings.json'), 'utf8');
const settings = JSON.parse(settingsRaw);

const credPath = path.join(projectRoot, '.runtime/credentials.json');
let credentials = {};
try {
  credentials = JSON.parse(await fs.readFile(credPath, 'utf8'));
} catch {
  console.warn('No credentials file found; assuming already logged in via browser profile.');
}

const userDataDir = path.resolve(projectRoot, settings.amfori.browserUserDataDir);

// ---- 读取上次使用的 Monitoring ID ----
const template = await readLocalTemplate();
const monitoringId = template.monitoringId || '';

console.log(`Using Monitoring ID: ${monitoringId}`);
console.log(`Browser profile: ${userDataDir}`);

// ---- 启动浏览器 ----
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  slowMo: 100,
  viewport: { width: 1440, height: 900 },
});

const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(60000);

// ---- 导航到 ToDo 页面 ----
console.log('Navigating to amfori To Do page...');
await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, {
  waitUntil: 'domcontentloaded',
});

// ---- 如果需要登录 ----
const pwdLocator = page.locator("input[type='password']").first();
const needsLogin = await pwdLocator.isVisible().catch(() => false);
if (needsLogin) {
  console.log('Login page detected. Filling credentials...');
  const usr = credentials.username || '';
  const pwd = credentials.password || '';
  if (!usr || !pwd) {
    console.error('ERROR: No credentials found. Please fill them in the AutoForm UI first, then re-run.');
    await context.close();
    process.exit(1);
  }
  await page.locator("input[type='email'], input[name='username'], input[name='email']").first().fill(usr);
  await pwdLocator.fill(pwd);
  await page.locator("button[type='submit'], button:has-text('Login'), button:has-text('Sign in')").first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('Logged in. Navigating again...');
  await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, {
    waitUntil: 'domcontentloaded',
  });
}

// ---- 找到并打开目标 Monitoring ID ----
if (monitoringId) {
  console.log(`Looking for Monitoring ID: ${monitoringId}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const idLocator = page.getByText(monitoringId, { exact: true }).first();
  await idLocator.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
    throw new Error(`Monitoring ID "${monitoringId}" not found on page.`);
  });
  await idLocator.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('Project opened.');
} else {
  console.warn('No monitoringId in template. Please navigate to a project manually, then press Enter here.');
  await new Promise(resolve => process.stdin.once('data', resolve));
}

// ---- 点击 Report tab ----
console.log('Clicking Report tab...');
const reportTab = page.getByText('Report', { exact: true }).first();
await reportTab.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
  throw new Error('Report tab not found.');
});
await reportTab.click();
await page.waitForLoadState('networkidle').catch(() => {});
console.log('Report tab opened.');

// ---- 等待 2 秒让动态内容加载 ----
await page.waitForTimeout(2000);

// ---- 抓取所有可交互字段 ----
console.log('Scraping Report tab fields...');

const fields = await page.evaluate(() => {
  const result = [];

  // 遍历所有 input, textarea, select 元素
  const interactables = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="file"]), textarea, select'
  );

  interactables.forEach((el, index) => {
    const tagName = el.tagName.toLowerCase();
    const type = el.type || tagName;
    const name = el.name || '';
    const id = el.id || '';
    const placeholder = el.placeholder || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const required = el.required;
    const disabled = el.disabled;
    const readOnly = el.readOnly;

    // 找最近的 label
    let labelText = '';
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) labelText = label.textContent.trim();
    }
    if (!labelText) {
      const closestLabel = el.closest('label');
      if (closestLabel) {
        labelText = closestLabel.textContent.replace(el.value || '', '').trim();
      }
    }
    if (!labelText) {
      // 向上找父容器中的 label 或带 title 的元素
      let parent = el.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!parent) break;
        const labelEl = parent.querySelector('label, .label, [class*="label"], [class*="title"]');
        if (labelEl && labelEl !== el) {
          labelText = labelEl.textContent.trim();
          break;
        }
        parent = parent.parentElement;
      }
    }

    // 生成 CSS selector
    let selector = '';
    if (name) selector = `${tagName}[name="${name}"]`;
    else if (id) selector = `${tagName}#${id}`;
    else selector = `${tagName}:nth-of-type(${index + 1})`;

    // Select 选项
    let options = [];
    if (tagName === 'select') {
      options = [...el.options].map(o => ({ value: o.value, label: o.textContent.trim() }));
    }

    result.push({
      index,
      tagName,
      type,
      name,
      id,
      placeholder,
      ariaLabel,
      labelText,
      required,
      disabled,
      readOnly,
      selector,
      options,
      outerHTML: el.outerHTML.substring(0, 300),
    });
  });

  return result;
});

// ---- 过滤掉明显属于 General Description 或 Attachments 的字段 ----
const reportFields = fields.filter(f => {
  // 过滤掉 disabled/readonly 且无 name 的字段（通常是展示字段）
  // 保留所有有 name 或 id 的字段供分析
  return !f.disabled || f.name || f.id;
});

// ---- 保存结果 ----
const outputPath = path.join(__dirname, 'report_fields.json');
await fs.writeFile(outputPath, JSON.stringify(reportFields, null, 2), 'utf8');
console.log(`\n✅ Found ${reportFields.length} field(s) in Report tab.`);
console.log(`Results saved to: ${outputPath}`);
console.log('\n--- Field Summary ---');
reportFields.forEach(f => {
  console.log(`  [${f.type}] label="${f.labelText || f.ariaLabel || f.placeholder}" name="${f.name}" id="${f.id}" selector="${f.selector}"`);
});

// ---- 也截一张图 ----
const screenshotPath = path.join(__dirname, 'report_tab_screenshot.png');
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log(`Screenshot saved to: ${screenshotPath}`);

await context.close();
console.log('\nDone.');
