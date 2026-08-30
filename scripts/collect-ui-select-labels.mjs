import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadDotEnv } from '../src/env.js';

const root = process.cwd();
loadDotEnv();
const settings = JSON.parse(await fs.readFile(path.join(root, 'config/settings.json'), 'utf8'));
const template = JSON.parse(await fs.readFile(path.join(root, 'data/templates/default.json'), 'utf8'));
const index = JSON.parse(await fs.readFile(path.join(root, 'data/report-schema/index.json'), 'utf8'));
const credentials = await fs.readFile(path.join(root, '.runtime/credentials.json'), 'utf8').then(JSON.parse).catch(() => ({
  username: process.env.AMFORI_USERNAME,
  password: process.env.AMFORI_PASSWORD
}));
if (!template.monitoringId) throw new Error('Monitoring ID is required in data/templates/default.json.');

let browser = null;
let context;
try {
  context = await chromium.launchPersistentContext(path.resolve(root, settings.amfori.browserUserDataDir), {
    headless: false, slowMo: 25, viewport: { width: 1440, height: 900 }
  });
} catch {
  browser = await chromium.launch({ headless: false, slowMo: 25 });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
    await page.waitForFunction(
      () => !document.querySelector('input[type="password"]'),
      null,
      { timeout: settings.amfori.manualLoginTimeoutMs || 180000 }
    ).catch(() => { throw new Error('Login did not complete before timeout.'); });
    await page.goto(settings.amfori.todoUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  await page.route('**/*', (route) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.abort() : route.continue());

  await page.getByText(template.monitoringId, { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('a[href*="report-sections"], [id="tab-monitoring.report"]').length > 0, null, { timeout: 30000 }).catch(() => {});
  let reportHref = await page.evaluate(() => document.querySelector('a[href*="report-sections"]')?.href || '');
  if (!reportHref) {
    const tab = page.locator('[id="tab-monitoring.report"], a[role="tab"]:has-text("Report")').first();
    await tab.click();
    reportHref = await page.evaluate(() => document.querySelector('a[href*="report-sections"]')?.href || location.href);
  }
  if (!reportHref) throw new Error('Report tab link was not found.');

  const labelOutputPath = path.join(root, 'data/report-layout/ui-select-labels.json');
  const modules = await fs.readFile(labelOutputPath, 'utf8')
    .then((raw) => JSON.parse(raw).modules || {})
    .catch(() => ({}));
  for (const [position, module] of index.modules.entries()) {
    if (modules[module.id]) {
      console.log('Skip collected labels: ' + module.title);
      continue;
    }
    let collected = false;
    for (let attempt = 1; attempt <= 3 && !collected; attempt += 1) {
      await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
      const links = page.locator('a.js-open-section');
      const ready = await links.first().waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
      if (!ready) continue;
      await page.evaluate((sectionPosition) => {
        document.querySelectorAll('a.js-open-section')[sectionPosition]?.click();
      }, position);
      const opened = await page.locator('#sectionName, select#currentsection').first().waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
      if (!opened) continue;
      modules[module.id] = await page.evaluate(() => {
      const text = (element) => (element?.textContent || '').trim().replace(/\s+/g, ' ');
      const nearestLabel = (container) => {
        const component = container.closest('[class*="form-field-type-select"], .form-group');
        return text(component?.querySelector(':scope > label.control-label, :scope > label, .control-label, label'));
      };
      return Object.fromEntries(
        [...document.querySelectorAll('.ui-select-container')].map((container, uiSelectIndex) => [uiSelectIndex, nearestLabel(container)])
      );
      });
      await fs.writeFile(
        labelOutputPath,
      JSON.stringify({ version: 1, monitoringId: template.monitoringId, modules }, null, 2) + '\n'
      );
      console.log('Collected labels: ' + module.title);
      collected = true;
    }
    if (!collected) throw new Error('Could not open Report module after retries: ' + module.title);
  }
  const output = { version: 1, monitoringId: template.monitoringId, modules };
  await fs.writeFile(path.join(root, 'data/report-layout/ui-select-labels.json'), JSON.stringify(output, null, 2) + '\n');
  console.log('Collected labels for ' + Object.keys(modules).length + ' modules.');
} finally {
  await context.close();
  await browser?.close();
}
