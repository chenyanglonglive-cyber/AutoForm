import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadDotEnv } from '../src/env.js';
import {
  configurePageTimeouts,
  ensureLoggedIn,
  fillReportField,
  hasTemplateValue,
  launchPersistentContext,
  normalizeFieldValue,
  openProjectByMonitoringId,
  openReportIndex,
  openReportModule,
  resolveReportFieldLocator
} from '../src/automation/amforiBot.js';
import { ensureDir, readJsonFile, resolveFromRoot, writeJsonFile } from '../src/storage.js';
import { readLocalTemplate } from '../src/localTemplateStorage.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RESULT_PATH = 'data/report-dry-run-result.json';
const SCREENSHOT_DIR = 'data/screenshots';
const openOnly = process.argv.includes('--open-only') || process.argv.includes('--expand-only');

loadDotEnv();
const settings = await readJsonFile('config/settings.json');
const baseTemplate = await readLocalTemplate();
const reportTemplate = await readJsonFile('data/templates/report-imported.json');
const reportIndex = await readJsonFile('data/report-schema/index.json');
const credentials = mergeCredentials(await readJsonSafe('.runtime/credentials.json'));
const monitoringId = String(baseTemplate.monitoringId || '').trim();

if (!monitoringId) {
  throw new Error('Monitoring ID is required in data/templates/local-default.json.');
}

const reportValues = reportTemplate.modules || {};
const modules = await loadReportModules(reportIndex);
const steps = [];
const writeRequests = [];
let browser = null;
let context = null;
let sessionMode = 'persistent-profile';

const addStep = (message) => {
  const line = { time: new Date().toISOString(), message };
  steps.push(line);
  console.log(message);
};

try {
  ({ context, browser, sessionMode } = await launchContext(settings));
  const page = context.pages()[0] || await context.newPage();
  configurePageTimeouts(page, settings);

  addStep('Opening amfori To Do page.');
  await page.goto(settings.amfori.todoUrl || settings.amfori.platformUrl, { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(page, settings, credentials, addStep);
  await installWriteBlocker(context, writeRequests);

  await openProjectByMonitoringId(page, monitoringId, settings, addStep);
  const reportIndexUrl = await openReportIndex(page, addStep);

  const results = [];
  for (const module of modules) {
    const moduleResult = await testReportModule(page, module, reportIndexUrl, reportValues[module.id] || {}, addStep, { openOnly });
    results.push(moduleResult);
    const statusText = moduleResult.status === 'success'
      ? 'ok'
      : moduleResult.status;
    addStep(`${module.title}: ${statusText}; verified ${moduleResult.verifiedFields}, failed ${moduleResult.failedFields}, skipped ${moduleResult.skippedFields}.`);
  }

  const output = buildOutput(results, writeRequests, sessionMode, steps);
  await writeJsonFile(RESULT_PATH, output);
  console.log(JSON.stringify(output.summary, null, 2));

  if (
    output.summary.failedModules > 0
    || output.summary.failedFields > 0
    || output.summary.blockedModules > 0
    || output.summary.blockedFields > 0
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  const output = {
    time: new Date().toISOString(),
    status: 'failed',
    monitoringId,
    reason: error.message,
    writeRequestsBlocked: true,
    writeRequests,
    steps
  };
  await writeJsonFile(RESULT_PATH, output).catch(() => {});
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}

async function launchContext(runtimeSettings) {
  try {
    const persistentContext = await launchPersistentContext(runtimeSettings);
    return { context: persistentContext, browser: null, sessionMode: 'persistent-profile' };
  } catch (error) {
    addStep(`Persistent browser profile is busy; using a temporary profile for this dry run (${error.message}).`);
    const temporaryBrowser = await chromium.launch({
      headless: Boolean(runtimeSettings.automation.headless),
      slowMo: Number(runtimeSettings.automation.slowMoMs || 0)
    });
    const temporaryContext = await temporaryBrowser.newContext({ viewport: { width: 1440, height: 900 } });
    return { context: temporaryContext, browser: temporaryBrowser, sessionMode: 'temporary-profile' };
  }
}

async function loadReportModules(index) {
  const loaded = [];
  for (const [position, entry] of (index.modules || []).entries()) {
    const module = await readJsonFile(path.join('data', 'report-schema', entry.file));
    loaded.push({
      ...module,
      sectionOrder: Number.isFinite(Number(module.sectionOrder)) ? Number(module.sectionOrder) : position
    });
  }
  return loaded.sort((left, right) => Number(left.sectionOrder) - Number(right.sectionOrder));
}

async function installWriteBlocker(browserContext, blockedRequests) {
  await browserContext.route('**/*', (route) => {
    const request = route.request();
    const method = request.method();
    if (WRITE_METHODS.has(method)) {
      blockedRequests.push({
        time: new Date().toISOString(),
        method,
        url: sanitizeUrl(request.url())
      });
      return route.abort();
    }
    return route.continue();
  });
}

async function testReportModule(page, module, reportIndexUrl, moduleValues, addStep, options = {}) {
  const fields = [...(module.fields || [])].sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  const fieldsWithValues = fields.filter((field) => hasTemplateValue(moduleValues, field));
  const result = {
    id: module.id,
    title: module.title,
    status: 'pending',
    totalFields: fields.length,
    templateFields: fieldsWithValues.length,
    fillableFields: fieldsWithValues.filter((field) => field.type !== 'radio' || moduleValues[field.key] === true).length,
    filledFields: 0,
    verifiedFields: 0,
    failedFields: 0,
    blockedFields: 0,
    skippedFields: fields.length - fieldsWithValues.length,
    errors: [],
    screenshot: ''
  };

  try {
    await openReportModule(page, module, reportIndexUrl, addStep);
    result.status = fieldsWithValues.length === 0 ? 'skipped' : 'opened';

    if (options.openOnly) {
      const visibleFields = await page.evaluate(() =>
        document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select').length
      );
      result.status = 'opened';
      result.visibleFields = visibleFields;
      return result;
    }

    const fillFailures = new Set();
    for (const field of fieldsWithValues) {
      const value = moduleValues[field.key];
      if (field.type === 'radio' && value !== true) {
        continue;
      }

      try {
        await fillReportFieldWithRowRetry(page, module, field, value, addStep);
        result.filledFields += 1;
      } catch (error) {
        fillFailures.add(field.key);
        const blocked = isFieldNotFoundError(error);
        if (blocked) {
          result.blockedFields += 1;
        } else {
          result.failedFields += 1;
        }
        result.errors.push(fieldError(blocked ? 'blocked' : 'fill', field, value, error.message));
      }
    }

    for (const field of fieldsWithValues) {
      if (fillFailures.has(field.key)) {
        continue;
      }
      try {
        await verifyDryRunField(page, field, moduleValues[field.key]);
        result.verifiedFields += 1;
      } catch (error) {
        result.failedFields += 1;
        result.errors.push(fieldError('verify', field, moduleValues[field.key], error.message));
      }
    }

    if (result.failedFields > 0) {
      result.status = 'failed';
      result.screenshot = await captureModuleScreenshot(page, module);
    } else if (result.blockedFields > 0) {
      result.status = 'blocked';
      result.screenshot = await captureModuleScreenshot(page, module);
    } else if (fieldsWithValues.length === 0) {
      result.status = 'skipped';
    } else {
      result.status = 'success';
    }
  } catch (error) {
    result.status = 'failed';
    result.failedFields += Math.max(fieldsWithValues.length - result.verifiedFields, 1);
    result.errors.push({ stage: 'module', message: error.message });
    result.screenshot = await captureModuleScreenshot(page, module);
  }

  return result;
}

async function fillReportFieldWithRowRetry(page, module, field, value, addStep) {
  try {
    await fillReportField(page, field, value);
    return;
  } catch (error) {
    if (!/Field not found|not found/i.test(error.message)) {
      throw error;
    }

    const rowWasAdded = await ensureRepeaterRowForField(page, field);
    if (!rowWasAdded) {
      throw error;
    }

    addStep(`${module.title}: added a missing repeat row for ${field.label || field.key}.`);
    await fillReportField(page, field, value);
  }
}

async function ensureRepeaterRowForField(page, field) {
  const rowInfo = parseRepeaterKey(field.key);
  if (!rowInfo || rowInfo.rowIndex <= 0) {
    return false;
  }

  let added = false;
  for (let attempt = 0; attempt < rowInfo.rowIndex + 2; attempt += 1) {
    const state = await getRepeaterState(page, rowInfo.baseKey);
    if (state.rows.includes(rowInfo.rowIndex)) {
      return added;
    }
    if (state.rows.length === 0) {
      return false;
    }

    const anchorId = state.anchorId;
    const addButton = await resolveNextAddButton(page, anchorId);
    const canAdd = Boolean(addButton) && await addButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!canAdd) {
      return false;
    }

    await addButton.scrollIntoViewIfNeeded().catch(() => {});
    await addButton.click({ timeout: 5000 });
    added = true;
    await page.waitForTimeout(500);
  }

  const finalState = await getRepeaterState(page, rowInfo.baseKey);
  return added && finalState.rows.includes(rowInfo.rowIndex);
}

async function resolveNextAddButton(page, anchorId) {
  const anchor = page.locator(`[id="${escapeAttributeValue(anchorId)}"]`).first();
  const tableButton = anchor
    .locator('xpath=ancestor::table[1]/following::button[contains(normalize-space(.), "Add")][1]');
  if (await tableButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    return tableButton;
  }

  const token = `dry-run-add-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const found = await page.evaluate(({ id, tokenValue }) => {
    const anchorElement = document.getElementById(id);
    if (!anchorElement) {
      return false;
    }

    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };

    const controls = [...document.querySelectorAll('button, a')]
      .filter((element) => /\bAdd\b/i.test(element.textContent || ''))
      .filter((element) => isVisible(element))
      .filter((element) => Boolean(anchorElement.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));

    const control = controls[0];
    if (!control) {
      return false;
    }

    control.setAttribute('data-dry-run-add-token', tokenValue);
    return true;
  }, { id: anchorId, tokenValue: token });

  if (!found) {
    return null;
  }

  return page.locator(`[data-dry-run-add-token="${token}"]`).first();
}

async function getRepeaterState(page, baseKey) {
  const escapedPrefix = escapeRegExp(baseKey);
  return page.evaluate((prefixPattern) => {
    const rowPattern = new RegExp(`^${prefixPattern}-(\\d+)-\\d+(?:-.+)?$`);
    const items = [...document.querySelectorAll('[id]')]
      .map((element) => element.id)
      .map((id) => {
        const match = id.match(rowPattern);
        return match ? { id, row: Number(match[1]) } : null;
      })
      .filter(Boolean);
    const rows = [...new Set(items.map((item) => item.row))].sort((left, right) => left - right);
    const maxRow = rows.length ? rows[rows.length - 1] : -1;
    const anchorId = [...items].reverse().find((item) => item.row === maxRow)?.id || '';
    return { rows, anchorId };
  }, escapedPrefix);
}

async function verifyDryRunField(page, field, expected) {
  if (field.type === 'ui-select') {
    const container = page.locator('.ui-select-container').nth(Number(field.uiSelectIndex || 0));
    await container.waitFor({ state: 'attached', timeout: 5000 });
    const actualText = normalizeFieldValue(await container.innerText().catch(() => ''));
    if (!containsNormalized(actualText, expected)) {
      throw new Error(`expected custom dropdown to show "${expected}", got "${actualText}"`);
    }
    return;
  }

  const locator = await resolveReportFieldLocator(page, field);
  if (field.type === 'radio' || field.type === 'checkbox') {
    const actual = Boolean(await locator.isChecked());
    const expectedBoolean = toBoolean(expected);
    if (actual !== expectedBoolean) {
      throw new Error(`expected ${expectedBoolean ? 'checked' : 'unchecked'}, got ${actual ? 'checked' : 'unchecked'}`);
    }
    return;
  }

  if (field.type === 'select') {
    const actualValue = normalizeFieldValue(await locator.inputValue());
    const actualLabel = normalizeFieldValue(await locator.locator('option:checked').textContent().catch(() => ''));
    const normalizedExpected = normalizeExpected(field, expected);
    if (normalizeExpected(field, actualValue) !== normalizedExpected && normalizeExpected(field, actualLabel) !== normalizedExpected) {
      throw new Error(`expected "${expected}", got value "${actualValue}" / label "${actualLabel}"`);
    }
    return;
  }

  const actual = await locator.inputValue();
  if (normalizeExpected(field, actual) !== normalizeExpected(field, expected)) {
    throw new Error(`expected "${expected}", got "${actual}"`);
  }
}

function parseRepeaterKey(key) {
  const match = String(key || '').match(/^(.+)-(\d+)-(\d+)(?:-.+)?$/);
  if (!match) {
    return null;
  }
  return {
    baseKey: match[1],
    rowIndex: Number(match[2]),
    columnIndex: Number(match[3])
  };
}

function buildOutput(results, blockedRequests, mode, collectedSteps) {
  const summary = results.reduce((accumulator, result) => {
    accumulator.openedModules += ['opened', 'success', 'skipped', 'blocked', 'failed'].includes(result.status) ? 1 : 0;
    accumulator.successModules += result.status === 'success' ? 1 : 0;
    accumulator.skippedModules += result.status === 'skipped' ? 1 : 0;
    accumulator.blockedModules += result.status === 'blocked' ? 1 : 0;
    accumulator.failedModules += result.status === 'failed' ? 1 : 0;
    accumulator.totalFields += result.totalFields;
    accumulator.templateFields += result.templateFields;
    accumulator.fillableFields += result.fillableFields;
    accumulator.filledFields += result.filledFields;
    accumulator.verifiedFields += result.verifiedFields;
    accumulator.failedFields += result.failedFields;
    accumulator.blockedFields += result.blockedFields;
    accumulator.skippedFields += result.skippedFields;
    return accumulator;
  }, {
    totalModules: results.length,
    openedModules: 0,
    successModules: 0,
    skippedModules: 0,
    blockedModules: 0,
    failedModules: 0,
    totalFields: 0,
    templateFields: 0,
    fillableFields: 0,
    filledFields: 0,
    verifiedFields: 0,
    failedFields: 0,
    blockedFields: 0,
    skippedFields: 0,
    writeRequestsBlocked: blockedRequests.length
  });

  const status = summary.failedModules > 0 || summary.failedFields > 0
    ? 'failed'
    : summary.blockedModules > 0 || summary.blockedFields > 0
      ? 'blocked'
      : 'success';

  return {
    time: new Date().toISOString(),
    status,
    monitoringId,
    mode: openOnly ? 'open-only' : 'fill-and-verify',
    sessionMode: mode,
    writeRequestsBlocked: true,
    summary,
    writeRequests: blockedRequests,
    modules: results,
    steps: collectedSteps
  };
}

function normalizeExpected(field, value) {
  const normalized = normalizeFieldValue(value);
  if (field.type === 'time') {
    const match = normalized.match(/^(\d{1,2}:\d{2})(?::\d{2})?(?:\.\d+)?$/);
    if (match) return match[1];
  }
  return normalized;
}

function containsNormalized(actual, expected) {
  const normalizedActual = normalizeFieldValue(actual).toLowerCase();
  const normalizedExpected = normalizeFieldValue(expected).toLowerCase();
  return normalizedExpected === '' || normalizedActual.includes(normalizedExpected);
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', 'yes', '1', 'checked'].includes(String(value || '').trim().toLowerCase());
}

function fieldError(stage, field, expected, message) {
  return {
    stage,
    key: field.key,
    type: field.type,
    label: field.label || field.key,
    expected,
    message
  };
}

function isFieldNotFoundError(error) {
  return /Field not found|not found/i.test(error.message || '');
}

async function captureModuleScreenshot(page, module) {
  await ensureDir(resolveFromRoot(SCREENSHOT_DIR));
  const fileName = `${String(Number(module.sectionOrder || 0) + 1).padStart(2, '0')}-${safeFileName(module.title)}-dry-run.png`;
  const screenshotPath = resolveFromRoot(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
  return path.relative(resolveFromRoot(), screenshotPath).replace(/\\/g, '/');
}

function safeFileName(value) {
  return String(value || 'module')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .toLowerCase();
}

function escapeAttributeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(value).split('?')[0];
  }
}

async function readJsonSafe(relativePath) {
  return fs.readFile(resolveFromRoot(relativePath), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}));
}

function mergeCredentials(credentials = {}) {
  return {
    username: String(credentials.username || process.env.AMFORI_USERNAME || '').trim(),
    password: String(credentials.password || process.env.AMFORI_PASSWORD || '').trim()
  };
}
