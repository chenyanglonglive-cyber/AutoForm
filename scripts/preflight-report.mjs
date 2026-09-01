import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadDotEnv } from '../src/env.js';
import { readLocalTemplate } from '../src/localTemplateStorage.js';

const root = process.cwd();
loadDotEnv();
const settings = JSON.parse(await fs.readFile(path.join(root, 'config/settings.json'), 'utf8'));
const template = await readLocalTemplate();
const reportIndex = JSON.parse(await fs.readFile(path.join(root, 'data/report-schema/index.json'), 'utf8'));
const credentials = await fs.readFile(path.join(root, '.runtime/credentials.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => ({
    username: process.env.AMFORI_USERNAME,
    password: process.env.AMFORI_PASSWORD
  }));
const targets = [
  '01-monitoring-details',
  '04-production-and-employment-structure',
  '11-pa1-social-management-system',
  '17-pa-7-occupational-health-and-safety'
].map((id) => reportIndex.modules.find((module) => module.id === id)).filter(Boolean);

if (!template.monitoringId) throw new Error('Monitoring ID is required in data/templates/local-default.json.');
if (targets.length !== 4) throw new Error('Representative Report modules are missing from the schema index.');

let browser = null;
let sessionMode = 'persistent-profile';
let context;
try {
  context = await chromium.launchPersistentContext(
    path.resolve(root, settings.amfori.browserUserDataDir),
    { headless: false, slowMo: 40, viewport: { width: 1440, height: 900 } }
  );
} catch {
  // Do not interrupt a user-held profile. Use an ephemeral session for this read-only check.
  browser = await chromium.launch({ headless: false, slowMo: 40 });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  sessionMode = 'temporary-profile';
}
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(30000);

try {
  await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
  const password = page.locator(settings.login.passwordSelector).first();
  if (await password.isVisible().catch(() => false)) {
    if (!credentials.username || !credentials.password) throw new Error('Login is required but local credentials are unavailable.');
    await page.locator(settings.login.usernameSelector).first().fill(credentials.username);
    await password.fill(credentials.password);
    await Promise.allSettled([page.waitForLoadState('networkidle'), page.locator(settings.login.submitSelector).first().click()]);
  }

  // Login is complete. From this point the preflight may only make GET requests.
  await page.route('**/*', (route) => {
    const method = route.request().method();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return route.abort();
    return route.continue();
  });

  const project = page.getByText(template.monitoringId, { exact: true }).first();
  await project.waitFor({ state: 'visible' });
  await project.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(
    () => document.querySelectorAll('a[href*="report-sections"], [id="tab-monitoring.report"], a[role="tab"]').length > 0,
    null,
    { timeout: 30000 }
  ).catch(() => {});

  let reportHref = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a[href*="report-sections"]')][0];
    return link?.href || '';
  });
  if (!reportHref) {
    const reportTab = page.locator('[id="tab-monitoring.report"], a[role="tab"]:has-text("Report")').first();
    if (await reportTab.isVisible().catch(() => false)) {
      await reportTab.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      reportHref = await page.evaluate(() => document.querySelector('a[href*="report-sections"]')?.href || location.href);
    }
  }
  if (!reportHref) throw new Error('Report tab link was not found on the current project.');

  const results = [];
  for (const module of targets) {
    await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
    await page.locator('a.js-open-section').first().waitFor({ state: 'visible' });
    const links = page.locator('a.js-open-section');
    const link = links.nth(reportIndex.modules.findIndex((item) => item.id === module.id));
    await link.click();
    await page.locator('#sectionName, select#currentsection').first().waitFor({ state: 'visible' });

    const result = await page.evaluate(() => ({
      title: document.querySelector('#sectionName')?.textContent?.trim() || '',
      saveButton: Boolean(document.querySelector('#saveButtonTop, button#saveButton')),
      totalFields: document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select').length,
      uiSelects: document.querySelectorAll('.ui-select-container').length,
      collapsedPanels: document.querySelectorAll('.panel-collapse:not(.in), .collapse:not(.in)').length
    }));

    const firstContainer = page.locator('.ui-select-container').first();
    let uiSelectOpens = null;
    if (result.uiSelects > 0) {
      await firstContainer.click();
      uiSelectOpens = await firstContainer.locator('input.ui-select-search').first().isVisible().catch(() => false);
      await page.keyboard.press('Escape').catch(() => {});
    }

    results.push({ module: module.title, ...result, uiSelectOpens });
  }

  const output = {
    time: new Date().toISOString(), monitoringId: template.monitoringId,
    writeRequestsBlocked: true, sessionMode, results
  };
  await fs.writeFile(path.join(root, 'data/report-preflight.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await context.close();
  await browser?.close();
}
