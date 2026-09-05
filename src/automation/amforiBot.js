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
    const filledFields = generalDescriptionFilled;
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
      modules: ['General Description'],
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

export async function runAmforiReportAutomation({ monitoringId, modules, values, credentials, settings, onModuleProgress }) {
  const steps = [];
  const completedModules = [];
  const moduleResults = (modules || []).map((module) => ({
    id: module.id,
    title: module.title,
    status: 'pending',
    filledFields: 0,
    reason: '',
    screenshot: ''
  }));
  let context;
  let page;
  let screenshot = '';
  let filledFields = 0;

  const addStep = (message) => steps.push({ time: new Date().toISOString(), message });
  const updateModule = (module, update) => {
    const result = moduleResults.find((entry) => entry.id === module.id);
    if (!result) return;
    Object.assign(result, update);
    onModuleProgress?.(structuredClone(result));
  };

  try {
    if (!String(monitoringId || '').trim()) {
      throw new Error('Monitoring ID is required.');
    }
    if (!Array.isArray(modules) || modules.length === 0) {
      throw new Error('No Report modules were selected.');
    }

    context = await launchPersistentContext(settings);
    page = context.pages()[0] || await context.newPage();
    configurePageTimeouts(page, settings);
    await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, { waitUntil: 'domcontentloaded' });
    await ensureLoggedIn(page, settings, credentials, addStep);
    await openProjectByMonitoringId(page, monitoringId, settings, addStep);
    const reportIndexUrl = await openReportIndex(page, addStep);

    for (const module of modules) {
      updateModule(module, { status: 'running', reason: '', screenshot: '' });
      const moduleValues = values?.[module.id] || {};
      const { fieldsToFill, skippedConditionalFields } = getReportFieldsToFill(moduleValues, module.fields);
      if (skippedConditionalFields.length > 0) {
        const labels = skippedConditionalFields.map((field) => field.label || field.key).join(', ');
        addStep(`${module.title}: skipped hidden conditional field(s): ${labels}.`);
      }
      if (fieldsToFill.length === 0) {
        addStep(`${module.title}: no local values, skipped.`);
        completedModules.push(module.title);
        updateModule(module, { status: 'skipped' });
        continue;
      }
      const missingRequiredFields = getMissingTemplateRequiredFields(moduleValues, module.fields);
      if (missingRequiredFields.length > 0) {
        const labels = missingRequiredFields.map(formatRequiredFieldLabel).join(', ');
        const reason = `模板缺少生产页面必填项：${labels}`;
        updateModule(module, { status: 'failed', reason });
        addStep(`${module.title}: ${reason}.`);
        continue;
      }

      try {
        await openReportModule(page, module, reportIndexUrl, addStep);
        const moduleFilled = await fillReportModuleFields(
          page,
          module,
          fieldsToFill,
          moduleValues,
          addStep
        );

        const confirmation = await clickSave(page, {
          selector: '#saveButtonTop:visible, button#saveButton:visible'
        }, settings, addStep);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(Number(settings.automation.saveSettleMs || 2500));
        await openReportModule(page, module, reportIndexUrl, addStep);
        await verifyReportModule(page, fieldsToFill, moduleValues);
        if (!confirmation) throw new Error(`${module.title}: Save confirmation was not received.`);

        filledFields += moduleFilled;
        completedModules.push(module.title);
        updateModule(module, { status: 'completed', filledFields: moduleFilled });
        addStep(`${module.title}: saved and refreshed (${moduleFilled} field(s)).`);
      } catch (error) {
        const moduleScreenshot = page ? await captureFailureScreenshot(page, `${monitoringId}_${module.id}`) : '';
        updateModule(module, {
          status: 'failed',
          reason: error.message,
          screenshot: moduleScreenshot
        });
        addStep(`${module.title}: failed and will require manual review (${error.message}).`);
        if (isBrowserClosedError(error)) throw error;
      }
    }

    const failedModules = moduleResults.filter((module) => module.status === 'failed');
    return {
      status: failedModules.length > 0 ? 'partial' : 'success', monitoringId, modules: modules.map((module) => module.title),
      completedModules, moduleResults, filledFields, saved: filledFields > 0, steps
    };
  } catch (error) {
    if (page) screenshot = await captureFailureScreenshot(page, monitoringId);
    for (const moduleResult of moduleResults) {
      if (moduleResult.status === 'pending' || moduleResult.status === 'running') {
        const status = moduleResult.status === 'running' ? 'failed' : 'not-run';
        const reason = moduleResult.status === 'running'
          ? error.message
          : `任务在此模块前停止：${error.message}`;
        Object.assign(moduleResult, { status, reason, screenshot });
        onModuleProgress?.(structuredClone(moduleResult));
      }
    }
    return {
      status: completedModules.length > 0 ? 'partial' : 'failed', monitoringId: monitoringId || '', reason: error.message, screenshot,
      completedModules, moduleResults, filledFields, saved: completedModules.length > 0, steps
    };
  } finally {
    if (context) await context.close();
  }
}

export async function launchPersistentContext(settings) {
  const userDataDir = resolveFromRoot(settings.amfori.browserUserDataDir);
  await ensureDir(userDataDir);

  return chromium.launchPersistentContext(userDataDir, {
    headless: Boolean(settings.automation.headless),
    slowMo: Number(settings.automation.slowMoMs || 0),
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 }
  });
}

export function configurePageTimeouts(page, settings) {
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

export async function ensureLoggedIn(page, settings, credentials, addStep) {
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

export async function openProjectByMonitoringId(page, monitoringId, settings, addStep) {
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

export async function openReportIndex(page, addStep) {
  let reportHref = '';
  for (let attempt = 0; attempt < 3 && !reportHref; attempt += 1) {
    reportHref = await page.locator('a[href*="report-sections"]').first().getAttribute('href').catch(() => '') || '';
    if (reportHref) break;
    const reportTab = page.locator('[id="tab-monitoring.report"], a[role="tab"]:has-text("Report")').first();
    if (await reportTab.isVisible().catch(() => false)) {
      await reportTab.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    } else if (attempt === 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(800);
  }

  if (reportHref) reportHref = new URL(reportHref, page.url()).href;
  if (!reportHref) {
    const currentReport = page.url().match(/^(.*\/report-sections)(?:\/[^/?#]+)?(?:[?#].*)?$/);
    reportHref = currentReport?.[1] || '';
  }

  if (!reportHref) {
    throw new Error('Report tab link was not found on the current project.');
  }

  await page.goto(reportHref, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('a.js-open-section').first().waitFor({ state: 'visible' }).catch(() => {
    throw new Error('Report module list was not found.');
  });
  addStep('Opened the current project Report module list.');
  return page.url();
}

export async function openReportModule(page, module, reportIndexUrl, addStep) {
  await page.goto(reportIndexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  const links = page.locator('a.js-open-section');
  await links.first().waitFor({ state: 'visible' }).catch(() => {
    throw new Error('Report module list was not found.');
  });

  let link = links.nth(Number(module.sectionOrder || 0));
  const indexedTitle = normalizeFieldValue(await link.textContent().catch(() => ''));
  if (indexedTitle !== normalizeFieldValue(module.title)) {
    link = links.filter({ hasText: module.title }).first();
  }

  await link.waitFor({ state: 'visible' }).catch(() => {
    throw new Error(`Report module was not found on the current project: ${module.title}`);
  });
  await link.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.locator('#sectionName, select#currentsection').first().waitFor({ state: 'visible' }).catch(() => {
    throw new Error(`Report module did not open: ${module.title}`);
  });
  await expandCollapsedPanels(page, addStep);
  addStep(`Opened Report module: ${module.title}.`);
}

async function prepareRepeatableReportModule(page, module, fieldsToFill, addStep) {
  const requiredRowsByGroup = new Map();
  for (const field of fieldsToFill) {
    const repeatable = field.repeatable;
    if (!repeatable) continue;
    requiredRowsByGroup.set(
      repeatable.groupId,
      Math.max(requiredRowsByGroup.get(repeatable.groupId) || 0, Number(repeatable.rowIndex) + 1)
    );
  }

  for (const [groupId, requiredRows] of requiredRowsByGroup) {
    const groupFields = module.fields.filter((field) => field.repeatable?.groupId === groupId);
    const anchorsByRow = new Map();
    for (const field of groupFields) {
      const repeatable = field.repeatable;
      if (!repeatable?.anchorSelector || anchorsByRow.has(repeatable.rowIndex)) continue;
      anchorsByRow.set(repeatable.rowIndex, repeatable);
    }
    const first = anchorsByRow.get(0);
    if (!first) continue;

    await page.locator(first.anchorSelector).waitFor({ state: 'attached', timeout: 8000 }).catch(() => {
      throw new Error(`${first.groupLabel}: first repeatable row was not found.`);
    });

    let addedRows = 0;
    for (let rowIndex = 1; rowIndex < requiredRows; rowIndex += 1) {
      const target = anchorsByRow.get(rowIndex);
      if (!target) continue;
      if (await page.locator(target.anchorSelector).count() > 0) continue;

      const previous = anchorsByRow.get(rowIndex - 1) || first;
      const addButton = await locateRepeatableAddButton(page, previous.anchorSelector, previous.addButtonTexts, groupId, rowIndex);
      await addButton.click();
      await page.locator(target.anchorSelector).waitFor({ state: 'attached', timeout: 8000 }).catch(async () => {
        const validation = await page.locator('.has-error .help-block:visible, .formio-errors:visible, .invalid-feedback:visible').allTextContents();
        throw new Error(`${target.groupLabel}：点击新增后未找到第 ${rowIndex + 1} 行（${target.anchorSelector}）。${validation.length ? `网页校验：${validation.join('；')}` : '请检查该组是否已新增，以及上一行必填项是否完整。'}`);
      });
      addedRows += 1;
    }

    if (addedRows > 0) addStep(`Prepared ${requiredRows} ${first.groupLabel} row(s).`);
  }
}

export async function locateRepeatableAddButton(page, anchorSelector, buttonTexts, groupId, rowIndex) {
  const marker = `autofill-repeatable-${groupId}-${rowIndex}`.replace(/[^a-z0-9_-]/gi, '-');
  const anchor = page.locator(anchorSelector).first();
  const found = await anchor.evaluate((element, options) => {
    const normalize = (text) => String(text).replace(/^\s*[+＋]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const texts = new Set(options.buttonTexts.map(normalize));
    let container = element.parentElement;
    while (container && container !== document.body) {
      const candidates = [...container.querySelectorAll('a, button')]
        .filter((candidate) => texts.has(normalize(candidate.textContent)))
        .filter((candidate) => candidate.getClientRects().length > 0);
      if (candidates.length > 0) {
        // Never choose a neighbouring grid's button merely because it is closer.
        if (candidates.length !== 1) return false;
        candidates[0].setAttribute('data-autofill-repeatable-add', options.marker);
        return true;
      }
      container = container.parentElement;
    }
    return false;
  }, { buttonTexts, marker });

  if (!found) {
    throw new Error(`Add button was not found for repeatable group: ${groupId}.`);
  }

  const button = page.locator(`[data-autofill-repeatable-add="${marker}"]`).first();
  await button.waitFor({ state: 'visible', timeout: 5000 });
  return button;
}

// 展开模块内默认关闭的折叠面板（如 PA 模块的 Finding 折叠区），使其中字段可见、可被填充。
// 通用做法：找到所有处于折叠态的折叠开关（aria-expanded="false" 且带 aria-controls），逐个点击展开。
// 该操作纯属客户端 UI 状态切换，不触发任何写请求。
async function expandCollapsedPanels(page, addStep) {
  const toggleSelector = 'a[role="button"][aria-expanded="false"][aria-controls]';
  // 部分模块的折叠区异步渲染，先等任一折叠开关出现；没有折叠面板的模块直接返回。
  const hasPanels = await page.locator('a[role="button"][aria-controls]').first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!hasPanels) {
    return;
  }

  const toggleIds = await page.evaluate((selector) =>
    [...document.querySelectorAll(selector)].map((element) => element.id).filter(Boolean),
    toggleSelector
  );

  let expanded = 0;
  for (const id of toggleIds) {
    const toggle = page.locator(`a[id="${id}"]`);
    if (await toggle.count() === 0) continue;
    const stillCollapsed = await toggle
      .evaluate((element) => element.getAttribute('aria-expanded') === 'false')
      .catch(() => false);
    if (!stillCollapsed) continue;
    await toggle.scrollIntoViewIfNeeded().catch(() => {});
    await toggle.click({ timeout: 5000 }).catch(() => {});
    expanded += 1;
    await page.waitForTimeout(120);
  }

  if (expanded > 0) {
    addStep(`Expanded ${expanded} collapsed panel(s) so their fields are visible.`);
  }
  await page.waitForTimeout(250);
}

export function hasTemplateValue(values, field) {
  if (!Object.hasOwn(values, field.key)) return false;
  const value = values[field.key];
  return typeof value === 'boolean' || String(value ?? '').trim() !== '';
}

// Some amfori controls only exist after a preceding answer has been selected.
// Keep that dependency in the schema so templates from another audit do not
// fail merely because they retain values for a currently hidden control.
export function getReportFieldsToFill(values, fields) {
  const fieldsToFill = [];
  const skippedConditionalFields = [];

  for (const field of fields) {
    if (!hasTemplateValue(values, field)) continue;
    if ((field.skipValues || []).some((value) =>
      normalizeFieldValue(value).toLowerCase() === normalizeFieldValue(values[field.key]).toLowerCase()
    )) {
      skippedConditionalFields.push(field);
      continue;
    }
    if (!matchesFieldVisibilityCondition(values, field.visibleWhen)) {
      skippedConditionalFields.push(field);
      continue;
    }
    fieldsToFill.push(field);
  }

  return { fieldsToFill, skippedConditionalFields };
}

function isBrowserClosedError(error) {
  return /Target page, context or browser has been closed|browser has been closed|page has been closed/i.test(error?.message || '');
}

export function matchesFieldVisibilityCondition(values, condition) {
  if (!condition) return true;
  const actual = String(values?.[condition.field] ?? '').trim();
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals];
  return expected.map((value) => String(value ?? '').trim()).includes(actual);
}

export function getMissingTemplateRequiredFields(values, fields) {
  const moduleHasValues = fields.some((field) => hasTemplateValue(values, field));
  if (!moduleHasValues) return [];

  return fields.filter((field) => {
    if (!field.templateRequired || hasTemplateValue(values, field)) return false;
    if (field.templateRequired === 'module') return true;
    if (field.templateRequired !== 'repeatable-row' || !field.repeatable) return false;
    return fields.some((candidate) =>
      candidate.key !== field.key
      && candidate.repeatable?.groupId === field.repeatable.groupId
      && Number(candidate.repeatable?.rowIndex) === Number(field.repeatable.rowIndex)
      && hasTemplateValue(values, candidate)
    );
  });
}

function formatRequiredFieldLabel(field) {
  if (!field.repeatable) return field.label || field.key;
  return `${field.label || field.key}（第 ${Number(field.repeatable.rowIndex) + 1} 行）`;
}

export async function fillReportModuleFields(
  page,
  module,
  fieldsToFill,
  values,
  addStep,
  dependencies = {}
) {
  const ensureFieldRow = dependencies.ensureFieldRow || prepareRepeatableReportModule;
  const fillField = dependencies.fillField || fillReportField;
  let filledFields = 0;

  // Some amfori grids reject Add Another until the preceding required row is complete.
  // Ensure each row immediately before its first populated field is filled.
  for (const field of fieldsToFill) {
    await ensureFieldRow(page, module, [field], addStep);
    addStep(`Filling ${field.locationLabel || field.label || field.key} [${field.key}].`);
    await fillField(page, field, values[field.key]);
    filledFields += 1;
  }

  return filledFields;
}

export async function fillReportField(page, field, value) {
  const locator = await resolveReportFieldLocator(page, field);
  if (field.type === 'radio') {
    if (value === true) await locator.check();
    return;
  }
  if (field.type === 'checkbox') {
    if (value === true) await locator.check();
    else await locator.uncheck();
    await commitFieldChange(locator);
    return;
  }
  if (field.type === 'select') {
    const stringValue = String(value ?? '');
    await locator.selectOption(stringValue).catch(() => locator.selectOption({ label: stringValue }));
    await commitFieldChange(locator);
    return;
  }
  if (field.type === 'ui-select') {
    const text = String(value ?? '').trim();
    if (!text) return;
    await locator.fill(text);
    const container = locator.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ui-select-container ")][1]');
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const choice = container.locator('.ui-select-choices-row:visible, [role="option"]:visible')
      .filter({ hasText: new RegExp(`^\\s*${escapedText}\\s*$`, 'i') }).first();
    await choice.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      throw new Error(`Dropdown option not found for ${field.locationLabel || field.label} [${field.key}]: ${text}`);
    });
    await choice.click();
    await page.keyboard.press('Tab');
    const selected = await readReportDropdownValue(container);
    if (normalizeFieldValue(selected).toLowerCase() !== normalizeFieldValue(text).toLowerCase()) {
      throw new Error(`${field.locationLabel || field.label} [${field.key}]：点击选项后未确认选中「${text}」（实际「${selected}」）。`);
    }
    return;
  }
  const stringValue = String(value ?? '');
  await locator.fill(stringValue);
  await commitFieldChange(locator, stringValue);
}

export async function resolveReportFieldLocator(page, field) {
  if (field.type === 'ui-select') {
    const container = await resolveReportDropdownContainer(page, field);
    const search = container.locator('input.ui-select-search');
    await search.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
      throw new Error(`Custom dropdown not found: ${field.label}`);
    });
    await container.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      throw new Error(`Custom dropdown container not found: ${field.label}`);
    });
    await container.click();
    await search.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      throw new Error(`Custom dropdown did not open: ${field.label}`);
    });
    return search;
  }
  return resolveFieldLocator(page, field);
}

export async function resolveReportDropdownContainer(page, field) {
  if (!field.locatorScope) {
    return page.locator('.ui-select-container').nth(Number(field.uiSelectIndex || 0));
  }
  const marker = `report-${field.key}`;
  const result = await page.evaluate(({ scope, marker }) => {
    const normalize = (text) => String(text || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim().toLowerCase();
    const isVisible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const anchors = scope.anchorSelectors.flatMap((selector) => [...document.querySelectorAll(selector)].filter(isVisible));
    let root;
    if (anchors.length) {
      root = anchors[0].parentElement;
      while (root && !anchors.every((anchor) => root.contains(anchor))) root = root.parentElement;
    } else if (!scope.anchorSelectors.length) {
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,.panel-heading,.card-header')]
        .filter((element) => normalize(element.textContent) === normalize(scope.title) && isVisible(element));
      const leaves = headings.filter((heading) => !headings.some((other) => other !== heading && heading.contains(other)));
      if (leaves.length === 1) root = leaves[0].parentElement;
    }
    if (!root) return '所在区域或行未找到';
    while (root && root !== document.body && root.tagName !== 'FORM') {
      const containers = [...root.querySelectorAll('.ui-select-container')];
      if (containers.length) {
        const labelled = scope.label ? containers.filter((container) => {
          const component = container.closest('.form-group, [class*="form-field-type-select"], .formio-component-select');
          const labels = component ? [...component.querySelectorAll('label')].filter((label) => !label.closest('.ui-select-container')) : [];
          return labels.some((label) => normalize(label.textContent) === normalize(scope.label));
        }) : [];
        let chosen = labelled.length === 1 ? labelled[0] : null;
        if (!chosen && containers.length === scope.selectCount) chosen = containers[scope.selectIndex];
        if (!chosen) return `区域内下拉框无法唯一匹配（找到 ${containers.length} 个，模板 ${scope.selectCount} 个）`;
        chosen.setAttribute('data-report-dropdown', marker);
        return '';
      }
      root = root.parentElement;
    }
    return '所在区域内未找到下拉框';
  }, { scope: field.locatorScope, marker });
  if (result) throw new Error(`${field.locationLabel || field.label} [${field.key}]：${result}。`);
  return page.locator(`[data-report-dropdown=${JSON.stringify(marker)}]`);
}

export async function verifyReportModule(page, fields, values) {
  for (const field of fields) {
    if (field.type === 'ui-select') {
      const container = await resolveReportDropdownContainer(page, field);
      const matches = await readReportDropdownValue(container);
      if (normalizeFieldValue(matches).toLowerCase() !== normalizeFieldValue(values[field.key]).toLowerCase()) {
        throw new Error(`${field.locationLabel || field.label} [${field.key}] 保存后选项不一致：期望「${values[field.key]}」，实际「${matches.trim()}」。`);
      }
      continue;
    }
    const locator = await resolveReportFieldLocator(page, field);
    const expected = values[field.key];
    if (field.type === 'radio' || field.type === 'checkbox') {
      if (Boolean(await locator.isChecked()) !== Boolean(expected)) {
        throw new Error(`${field.label} was not persisted after Save.`);
      }
      continue;
    }
    if (field.type === 'select') {
      const actual = await locator.inputValue();
      if (normalizeFieldValue(actual) !== normalizeFieldValue(expected)) {
        throw new Error(`${field.label} was not persisted after Save.`);
      }
      continue;
    }
    const actual = await locator.inputValue();
    if (normalizeFieldValue(actual) !== normalizeFieldValue(expected)) {
      throw new Error(`${field.locationLabel || field.label} [${field.key}] 保存后内容不一致：期望「${expected}」，实际「${actual}」。`);
    }
  }
}

async function readReportDropdownValue(container) {
  // ui-select's match can include a remove button (×), which is not part of the value.
  const text = container.locator('.ui-select-match-text');
  if (await text.count()) return (await text.allTextContents()).join(', ').trim();
  return (await container.locator('.ui-select-match').innerText()).replace(/^\s*×\s*|\s*×\s*$/g, '').trim();
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
    ...(field.fallbackSelectors || []),
    field.xpathFallback
  ].filter(Boolean);

  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const found = await candidates.first().waitFor({ state: 'attached', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (found) {
      const visible = candidates.filter({ visible: true });
      const count = await visible.count();
      if (count === 1) return visible;
      if (count > 1) throw new Error(`${field.label || field.key} [${field.key}]：定位到多个可见输入框，请核对页面结构。`);
      // Some radio inputs are visually hidden by their labels; retain that support.
      if (await candidates.count() === 1 && ['radio', 'checkbox'].includes(field.type)) return candidates;
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

export function normalizeFieldValue(value) {
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
