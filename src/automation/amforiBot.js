import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureDir, listFilesInFolder, resolveFromRoot } from '../storage.js';

export async function runAmforiAttachmentUpload({ monitoringId, attachmentFolder, fileNames, credentials, mapping, settings }) {
  const steps = [];
  let context;
  let page;
  let screenshot = '';

  const addStep = (message) => {
    steps.push({ time: new Date().toISOString(), message });
  };

  try {
    if (!String(monitoringId || '').trim()) {
      throw new Error('Monitoring ID is required.');
    }
    if (!mapping.modules?.reportAttachments) {
      throw new Error('Report Attachments module is not configured.');
    }

    const attachmentFiles = await collectAttachmentFiles(attachmentFolder, addStep, fileNames);
    if (attachmentFiles.length === 0) {
      throw new Error('Attachment folder is empty; no files were uploaded.');
    }

    context = await launchPersistentContext(settings);
    page = context.pages()[0] || await context.newPage();
    configurePageTimeouts(page, settings);

    addStep('Opening amfori To Do page for attachment upload only.');
    await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, {
      waitUntil: 'domcontentloaded'
    });
    await ensureLoggedIn(page, settings, credentials, addStep);
    await openProjectByMonitoringId(page, monitoringId, settings, addStep);

    const uploadedFiles = await uploadAttachments(
      page,
      mapping.modules.reportAttachments,
      attachmentFiles,
      addStep
    );
    const saveConfirmation = await clickSave(page, mapping.saveButton, settings, addStep);

    return {
      status: 'success',
      monitoringId,
      modules: ['Report Attachments'],
      filledFields: 0,
      uploadedFiles,
      saved: true,
      saveConfirmation,
      steps
    };
  } catch (error) {
    if (page) {
      screenshot = await captureFailureScreenshot(page, monitoringId);
    }

    return {
      status: 'failed',
      monitoringId: monitoringId || '',
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

    context = await launchPersistentContext(settings);

    page = context.pages()[0] || await context.newPage();
    configurePageTimeouts(page, settings);

    addStep('Opening amfori To Do page.');
    await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, {
      waitUntil: 'domcontentloaded'
    });

    await ensureLoggedIn(page, settings, template.credentials, addStep);
    await openProjectByMonitoringId(page, template.monitoringId, settings, addStep);

    const generalDescriptionFilled = await fillModule(page, mapping.modules.generalDescription, template.fields, addStep);
    const reportFilled = await fillModule(page, mapping.modules.report, template.fields, addStep);

    const filledFields = generalDescriptionFilled + reportFilled;
    const hasChanges = filledFields > 0;
    let saveConfirmation = null;

    if (hasChanges) {
      saveConfirmation = await clickSave(page, mapping.saveButton, settings, addStep);
      await verifySavedFields(page, mapping, template.fields, settings, addStep);
    } else {
      addStep('No local field content or attachment files were provided; skipped Save.');
    }

    return {
      status: 'success',
      monitoringId: template.monitoringId,
      modules: ['General Description', 'Report'],
      filledFields,
      uploadedFiles: 0,
      saved: hasChanges,
      saveConfirmation,
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

async function launchPersistentContext(settings) {
  const userDataDir = resolveFromRoot(settings.amfori.browserUserDataDir);
  await ensureDir(userDataDir);

  return chromium.launchPersistentContext(userDataDir, {
    headless: Boolean(settings.automation.headless),
    slowMo: Number(settings.automation.slowMoMs || 0),
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 }
  });
}

function configurePageTimeouts(page, settings) {
  const timeout = Number(settings.amfori.navigationTimeoutMs || 60000);
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
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

async function collectAttachmentFiles(folderPath, addStep, selectedFileNames = null) {
  if (!String(folderPath || '').trim()) {
    addStep('Attachment folder is blank; skipped attachment upload.');
    return [];
  }

  const resolved = path.resolve(folderPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Attachment folder does not exist: ${folderPath}`);
  }

  let files = await listFilesInFolder(resolved);
  if (files.length === 0) {
    addStep('Attachment folder is empty; skipped attachment upload.');
    return [];
  }

  if (Array.isArray(selectedFileNames)) {
    const filesByName = new Map(files.map((filePath) => [path.basename(filePath), filePath]));
    const missingFiles = selectedFileNames.filter((fileName) => !filesByName.has(fileName));
    if (missingFiles.length > 0) {
      throw new Error(`Attachment files changed after preview: ${missingFiles.join(', ')}`);
    }
    files = selectedFileNames.map((fileName) => filesByName.get(fileName));
  }

  addStep(`Found ${files.length} attachment file(s).`);
  return files;
}

async function ensureLoggedIn(page, settings, credentials, addStep) {
  const passwordLocator = page.locator(settings.login.passwordSelector).first();
  const hasPasswordField = await passwordLocator.isVisible().catch(() => false);

  if (!hasPasswordField) {
    addStep('Login state appears valid.');
    return;
  }

  const username = String(credentials?.username || '').trim() || process.env[settings.login.usernameEnv];
  const password = String(credentials?.password || '').trim() || process.env[settings.login.passwordEnv];

  if (username && password) {
    addStep('Login page detected; filling saved local credentials.');
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
  const locator = await resolveFieldLocator(page, field);

  const stringValue = String(value ?? '');

  if (field.type === 'select') {
    await locator.selectOption({ label: stringValue }).catch(async () => {
      await locator.selectOption(stringValue);
    });
    await commitFieldChange(locator);
    return;
  }

  if (field.type === 'checkbox') {
    const shouldCheck = ['true', 'yes', '1', 'checked'].includes(stringValue.toLowerCase());
    if (shouldCheck) {
      await locator.check();
    } else {
      await locator.uncheck();
    }
    await commitFieldChange(locator);
    return;
  }

  await locator.fill(stringValue);
  await commitFieldChange(locator, stringValue);
}

async function resolveFieldLocator(page, field) {
  const selectors = [
    field.selector,
    ...(field.fallbackSelectors || [])
  ].filter(Boolean);

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const found = await locator.waitFor({ state: 'attached', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (found) {
      return locator;
    }
  }

  throw new Error(`Field not found: ${field.label || field.localKey}`);
}

async function commitFieldChange(locator, value) {
  await locator.evaluate((element, nextValue) => {
    if (typeof nextValue === 'string' && 'value' in element) {
      const prototype = element.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor?.set?.call(element, nextValue);
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    element.blur?.();
  }, value).catch(() => {});
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

async function clickSave(page, saveButton, settings, addStep) {
  const save = page.locator(saveButton.selector).first();
  await save.waitFor({ state: 'visible' }).catch(() => {
    throw new Error('Save button not found.');
  });

  const timeout = Number(settings.automation.saveConfirmationTimeoutMs || 20000);
  const responseUrlIncludes = String(settings.automation.saveResponseUrlIncludes || '').trim();
  const responsePromise = page.waitForResponse((response) => {
    const method = response.request().method();
    const isWrite = ['POST', 'PUT', 'PATCH'].includes(method);
    const matchesUrl = !responseUrlIncludes || response.url().includes(responseUrlIncludes);
    return isWrite && matchesUrl;
  }, { timeout }).then((response) => ({
    type: 'response',
    status: response.status(),
    url: response.url()
  })).catch(() => null);

  const successTextPromise = waitForSaveSuccessText(page, settings)
    .then(() => ({ type: 'successText' }))
    .catch(() => null);

  await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
  await save.scrollIntoViewIfNeeded().catch(() => {});
  await hideChatWidget(page, addStep);

  try {
    await save.click({ timeout: 10000 });
  } catch (error) {
    addStep('Save was still covered after hiding the chat widget; retrying with a forced click.');
    await save.click({ force: true, timeout: 10000 });
  }
  addStep('Clicked Save; waiting for save confirmation.');

  const confirmation = await waitForFirstConfirmation([
    responsePromise,
    successTextPromise
  ], timeout);

  if (!confirmation) {
    throw new Error('Save confirmation timed out. The page may not have finished saving.');
  }

  if (confirmation.type === 'response' && confirmation.status >= 400) {
    throw new Error(`Save request failed with HTTP ${confirmation.status}.`);
  }

  await page.waitForTimeout(Number(settings.automation.saveSettleMs || 2500));
  addStep(`Save confirmation received via ${confirmation.type}.`);
  return confirmation;
}

async function hideChatWidget(page, addStep) {
  const hidden = await page.evaluate(() => {
    const selectors = ['#fc_frame', '#fc_widget', 'iframe[title="Chat"]'];
    const elements = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);

    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('pointer-events', 'none', 'important');
    }

    return elements.length;
  }).catch(() => 0);

  if (hidden > 0) {
    addStep('Temporarily hid the chat widget so it cannot cover Save.');
  }
}

async function waitForSaveSuccessText(page, settings) {
  const pattern = String(settings.automation.saveSuccessTextPattern || '').trim();
  if (!pattern) {
    return null;
  }

  await page.waitForFunction((source) => {
    const regex = new RegExp(source, 'i');
    return regex.test(document.body?.innerText || '');
  }, pattern, { timeout: Number(settings.automation.saveConfirmationTimeoutMs || 20000) });
}

async function waitForFirstConfirmation(promises, timeout) {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);

    for (const promise of promises) {
      promise.then((value) => {
        if (value) {
          clearTimeout(timer);
          resolve(value);
        }
      });
    }
  });
}

async function verifySavedFields(page, mapping, fields, settings, addStep) {
  const fieldsToVerify = Object.values(mapping.modules || {})
    .flatMap((moduleConfig) => (moduleConfig.fields || []).map((field) => ({ moduleConfig, field })))
    .filter(({ field }) => String(fields[field.localKey] ?? '').trim());

  if (fieldsToVerify.length === 0) {
    addStep('No text fields to verify after Save.');
    return;
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(Number(settings.automation.saveSettleMs || 2500));

  for (const { moduleConfig, field } of fieldsToVerify) {
    await clickTab(page, moduleConfig.tabText, addStep);
    const locator = await resolveFieldLocator(page, field);
    const actual = normalizeFieldValue(await locator.inputValue().catch(() => ''));
    const expected = normalizeFieldValue(fields[field.localKey]);

    if (actual !== expected) {
      throw new Error(`${field.label || field.localKey} was filled but was not persisted after Save.`);
    }
  }

  addStep(`Verified ${fieldsToVerify.length} saved field(s) after page reload.`);
}

function normalizeFieldValue(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
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
