import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureDir, listFilesInFolder, resolveFromRoot } from '../storage.js';

export async function runAmforiAutomation({ template, mapping, settings }) {
  const steps = [];
  let context;
  let page;
  let screenshot = '';

  const addStep = (message) => {
    steps.push({ time: new Date().toISOString(), message });
  };

  try {
    validateTemplate(template, mapping);
    const attachmentFiles = await collectAttachmentFiles(template.attachmentFolder, addStep);

    const userDataDir = resolveFromRoot(settings.amfori.browserUserDataDir);
    await ensureDir(userDataDir);

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: Boolean(settings.automation.headless),
      slowMo: Number(settings.automation.slowMoMs || 0),
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 }
    });

    page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(Number(settings.amfori.navigationTimeoutMs || 60000));
    page.setDefaultNavigationTimeout(Number(settings.amfori.navigationTimeoutMs || 60000));

    addStep('Opening amfori To Do page.');
    await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, {
      waitUntil: 'domcontentloaded'
    });

    await ensureLoggedIn(page, settings, addStep);
    await openProjectByMonitoringId(page, template.monitoringId, settings, addStep);

    const generalDescriptionFilled = await fillModule(page, mapping.modules.generalDescription, template.fields, addStep);
    const reportFilled = await fillModule(page, mapping.modules.report, template.fields, addStep);
    const uploadedFiles = await uploadAttachments(page, mapping.modules.reportAttachments, attachmentFiles, addStep);

    const filledFields = generalDescriptionFilled + reportFilled;
    const hasChanges = filledFields > 0 || uploadedFiles > 0;

    if (hasChanges) {
      await clickSave(page, mapping.saveButton, addStep);
    } else {
      addStep('No local field content or attachment files were provided; skipped Save.');
    }

    return {
      status: 'success',
      monitoringId: template.monitoringId,
      modules: ['General Description', 'Report', 'Report Attachments'],
      filledFields,
      uploadedFiles,
      saved: hasChanges,
      steps
    };
  } catch (error) {
    if (page) {
      screenshot = await captureFailureScreenshot(page, template.monitoringId);
    }

    return {
      status: 'failed',
      monitoringId: template.monitoringId || '',
      reason: error.message,
      screenshot,
      steps
    };
  } finally {
    if (context) {
      await context.close();
    }
  }
}

function validateTemplate(template, mapping) {
  if (!template || typeof template !== 'object') {
    throw new Error('Template data is missing.');
  }
  if (!template.monitoringId || !String(template.monitoringId).trim()) {
    throw new Error('Monitoring ID is required.');
  }

  const fields = template.fields || {};
  for (const moduleConfig of Object.values(mapping.modules || {})) {
    for (const field of moduleConfig.fields || []) {
      if (String(fields[field.localKey] ?? '').trim() && !field.selector) {
        throw new Error(`${field.label || field.localKey} selector is missing.`);
      }
    }
  }
}

async function collectAttachmentFiles(folderPath, addStep) {
  if (!String(folderPath || '').trim()) {
    addStep('Attachment folder is blank; skipped attachment upload.');
    return [];
  }

  const resolved = path.resolve(folderPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Attachment folder does not exist: ${folderPath}`);
  }

  const files = await listFilesInFolder(resolved);
  if (files.length === 0) {
    addStep('Attachment folder is empty; skipped attachment upload.');
    return [];
  }

  addStep(`Found ${files.length} attachment file(s).`);
  return files;
}

async function ensureLoggedIn(page, settings, addStep) {
  const passwordLocator = page.locator(settings.login.passwordSelector).first();
  const hasPasswordField = await passwordLocator.isVisible().catch(() => false);

  if (!hasPasswordField) {
    addStep('Login state appears valid.');
    return;
  }

  const username = process.env[settings.login.usernameEnv];
  const password = process.env[settings.login.passwordEnv];

  if (username && password) {
    addStep('Login page detected; filling credentials from environment variables.');
    await page.locator(settings.login.usernameSelector).first().fill(username);
    await passwordLocator.fill(password);
    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: settings.amfori.navigationTimeoutMs }),
      page.locator(settings.login.submitSelector).first().click()
    ]);
  } else {
    addStep('Login page detected; waiting for manual login in the opened browser.');
  }

  const timeout = Number(settings.amfori.manualLoginTimeoutMs || 180000);
  await page.waitForFunction(
    (passwordSelector) => !document.querySelector(passwordSelector),
    settings.login.passwordSelector,
    { timeout }
  ).catch(() => {
    throw new Error('Login was not completed before timeout.');
  });

  await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, {
    waitUntil: 'domcontentloaded'
  });
  addStep('Login completed.');
}

async function openProjectByMonitoringId(page, monitoringId, settings, addStep) {
  const idText = String(monitoringId).trim();
  addStep(`Looking for Monitoring ID ${idText}.`);

  const filterSelector = settings.projectLookup.monitoringIdFilterSelector;
  if (filterSelector) {
    const filter = page.locator(filterSelector).first();
    await filter.waitFor({ state: 'visible' });
    await filter.fill(idText);
    await filter.press('Enter');
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  const idLocator = settings.projectLookup.monitoringIdTextExact
    ? page.getByText(idText, { exact: true }).first()
    : page.getByText(idText).first();

  await idLocator.waitFor({ state: 'visible' }).catch(() => {
    throw new Error(`Monitoring ID not found: ${idText}`);
  });

  await Promise.allSettled([
    page.waitForLoadState('domcontentloaded'),
    idLocator.click()
  ]);

  await page.waitForLoadState('networkidle').catch(() => {});
  addStep(`Opened project ${idText}.`);
}

async function fillModule(page, moduleConfig, fields, addStep) {
  if (!moduleConfig) {
    return 0;
  }

  const configuredFields = moduleConfig.fields || [];
  if (configuredFields.length === 0) {
    addStep(`${moduleConfig.tabText}: no fields configured, skipped filling.`);
    return 0;
  }

  const fieldsWithContent = configuredFields.filter((field) => String(fields[field.localKey] ?? '').trim());
  if (fieldsWithContent.length === 0) {
    addStep(`${moduleConfig.tabText}: all local fields are blank, skipped module.`);
    return 0;
  }

  await clickTab(page, moduleConfig.tabText, addStep);

  let filledCount = 0;
  for (const field of configuredFields) {
    const value = fields[field.localKey];
    if (!String(value ?? '').trim()) {
      addStep(`${field.label || field.localKey}: blank value, skipped without overwriting.`);
      continue;
    }

    await fillField(page, field, value);
    filledCount += 1;
    addStep(`${moduleConfig.tabText}: overwrote ${field.label || field.localKey}.`);
  }

  return filledCount;
}

async function clickTab(page, tabText, addStep) {
  if (!tabText) {
    return;
  }

  const tab = page.getByText(tabText, { exact: true }).first();
  await tab.waitFor({ state: 'visible' }).catch(() => {
    throw new Error(`Module tab not found: ${tabText}`);
  });
  await tab.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  addStep(`Opened module: ${tabText}.`);
}

async function fillField(page, field, value) {
  const locator = page.locator(field.selector).first();
  await locator.waitFor({ state: 'attached' }).catch(() => {
    throw new Error(`Field not found: ${field.label || field.localKey}`);
  });

  const stringValue = String(value ?? '');

  if (field.type === 'select') {
    await locator.selectOption({ label: stringValue }).catch(async () => {
      await locator.selectOption(stringValue);
    });
    return;
  }

  if (field.type === 'checkbox') {
    const shouldCheck = ['true', 'yes', '1', 'checked'].includes(stringValue.toLowerCase());
    if (shouldCheck) {
      await locator.check();
    } else {
      await locator.uncheck();
    }
    return;
  }

  await locator.fill(stringValue);
}

async function uploadAttachments(page, moduleConfig, attachmentFiles, addStep) {
  if (attachmentFiles.length === 0) {
    addStep(`${moduleConfig.tabText}: no attachment files, skipped module.`);
    return 0;
  }

  await clickTab(page, moduleConfig.tabText, addStep);

  const input = page.locator(moduleConfig.attachmentSelector).first();
  await input.waitFor({ state: 'attached' }).catch(() => {
    throw new Error('Attachment upload control not found.');
  });

  await input.setInputFiles(attachmentFiles);
  await page.waitForLoadState('networkidle').catch(() => {});
  addStep(`Uploaded ${attachmentFiles.length} attachment file(s).`);
  return attachmentFiles.length;
}

async function clickSave(page, saveButton, addStep) {
  const save = page.locator(saveButton.selector).first();
  await save.waitFor({ state: 'visible' }).catch(() => {
    throw new Error('Save button not found.');
  });

  await Promise.allSettled([
    page.waitForLoadState('networkidle'),
    save.click()
  ]);
  addStep('Clicked Save.');
}

async function captureFailureScreenshot(page, monitoringId) {
  const safeId = String(monitoringId || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeId}.png`;
  const screenshotDir = resolveFromRoot('data', 'screenshots');
  await ensureDir(screenshotDir);
  const screenshotPath = path.join(screenshotDir, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
  return path.relative(resolveFromRoot(), screenshotPath).replace(/\\/g, '/');
}
