import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './env.js';
import {
  appendRunLog,
  ensureRuntimeFiles,
  readJsonFile,
  readRecentLogs,
  writeJsonFile
} from './storage.js';
import { runAmforiAttachmentUpload, runAmforiAutomation, runAmforiReportAutomation } from './automation/amforiBot.js';
import { readReportIndex, readReportModule, readReportTemplate, writeReportTemplate } from './reportStorage.js';
import { materializeRepeatableReportModule } from '../public/reportRepeatables.js';
import { ensureLocalTemplate, readLocalTemplate, writeLocalTemplate } from './localTemplateStorage.js';
import { readAppVersion } from './appVersion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');

let isRunning = false;
let reportRunProgress = null;

loadDotEnv();
await ensureRuntimeFiles();
await ensureLocalTemplate();

const settings = await readJsonFile('config/settings.json');
const server = http.createServer(handleRequest);

server.listen(settings.server.port, settings.server.host, () => {
  console.log(`amfori Auto Form is running at http://${settings.server.host}:${settings.server.port}`);
});

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/app-info') {
    sendJson(res, 200, { ok: true, ...(await readAppVersion()) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/template') {
    const template = await readLocalTemplate();
    const credentials = await readCredentials();
    const mapping = await readJsonFile('config/field-mapping.json');
    sendJson(res, 200, { ok: true, template: { ...template, credentials }, mapping });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    const requestedLimit = Number(url.searchParams.get('limit') || 50);
    const requestedOffset = Number(url.searchParams.get('offset') || 0);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 50;
    const offset = Number.isFinite(requestedOffset) ? Math.max(Math.trunc(requestedOffset), 0) : 0;
    const recentLogs = await readRecentLogs(limit + offset + 1);
    const logs = recentLogs.slice(offset, offset + limit);
    sendJson(res, 200, { ok: true, logs, limit, offset, hasMore: recentLogs.length > offset + limit });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/report/index') {
    sendJson(res, 200, { ok: true, index: await readReportIndex() });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/report/modules/')) {
    const moduleId = decodeURIComponent(url.pathname.slice('/api/report/modules/'.length));
    sendJson(res, 200, { ok: true, module: await readReportModule(moduleId) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/report/template') {
    sendJson(res, 200, { ok: true, template: await readReportTemplate() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/report/run-progress') {
    const runId = String(url.searchParams.get('runId') || '').trim();
    if (!reportRunProgress || (runId && reportRunProgress.runId !== runId)) {
      sendJson(res, 404, { ok: false, error: 'Report run progress was not found.' });
      return;
    }
    sendJson(res, 200, { ok: true, progress: reportRunProgress });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/report/template') {
    const body = await readJsonBody(req);
    const moduleId = String(body.moduleId || '').trim();
    const index = await readReportIndex();
    const module = index.modules.find((item) => item.id === moduleId);
    if (!module) {
      sendJson(res, 422, { ok: false, error: '请选择有效的 Report 模块后再保存。' });
      return;
    }
    const savedAt = new Date().toISOString();
    const existingTemplate = await readReportTemplate();
    const incomingModules = body.template?.modules && typeof body.template.modules === 'object'
      ? body.template.modules
      : {};
    await writeReportTemplate({
      ...existingTemplate,
      modules: {
        ...(existingTemplate.modules || {}),
        [module.id]: incomingModules[module.id] && typeof incomingModules[module.id] === 'object'
          ? incomingModules[module.id]
          : {}
      },
      moduleSavedAt: {
        ...(existingTemplate.moduleSavedAt || {}),
        ...(body.template?.moduleSavedAt || {}),
        [module.id]: savedAt
      }
    });
    const message = `Report 模块“${module.title}”已保存到本机`;
    const logEntry = await appendRunLog({
      time: savedAt,
      operation: 'report-template-save',
      monitoringId: String(body.monitoringId || '').trim(),
      moduleId: module.id,
      modules: [module.title],
      status: 'success',
      saved: true,
      message
    });
    sendJson(res, 200, { ok: true, message, savedAt, module: { id: module.id, title: module.title }, logEntry });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/report/run') {
    if (isRunning) {
      sendJson(res, 409, { ok: false, error: 'A task is already running.' });
      return;
    }

    isRunning = true;
    const body = await readJsonBody(req);
    const runId = String(body.runId || '').trim() || `report-${Date.now()}`;
    const monitoringId = String(body.monitoringId || '').trim();
    const index = await readReportIndex();
    const requestedIds = Array.isArray(body.moduleIds) ? body.moduleIds : [];
    const moduleIds = requestedIds.length > 0 ? requestedIds : index.modules.map((module) => module.id);
    const knownIds = new Set(index.modules.map((module) => module.id));

    if (!monitoringId) {
      isRunning = false;
      sendJson(res, 422, { ok: false, error: 'Monitoring ID is required.' });
      return;
    }
    if (moduleIds.some((id) => !knownIds.has(id))) {
      isRunning = false;
      sendJson(res, 422, { ok: false, error: 'One or more Report modules are invalid.' });
      return;
    }

    try {
      const credentials = await readCredentials();
      const currentSettings = await readJsonFile('config/settings.json');
      const template = body.template?.modules ? body.template : await readReportTemplate();
      await writeReportTemplate(template);
      const modules = await Promise.all(moduleIds.map(async (moduleId) => materializeRepeatableReportModule(
        await readReportModule(moduleId),
        template.modules?.[moduleId] || {}
      )));
      reportRunProgress = {
        runId,
        monitoringId,
        status: 'running',
        moduleResults: modules.map((module) => ({
          id: module.id,
          title: module.title,
          status: 'pending',
          filledFields: 0,
          reason: '',
          screenshot: ''
        })),
        updatedAt: new Date().toISOString()
      };
      const result = await runAmforiReportAutomation({
        monitoringId,
        modules,
        values: template.modules || {},
        credentials,
        settings: currentSettings,
        onModuleProgress: (moduleResult) => {
          const index = reportRunProgress.moduleResults.findIndex((entry) => entry.id === moduleResult.id);
          if (index >= 0) reportRunProgress.moduleResults[index] = moduleResult;
          reportRunProgress.updatedAt = new Date().toISOString();
        }
      });
      reportRunProgress = {
        ...reportRunProgress,
        status: result.status,
        moduleResults: result.moduleResults || reportRunProgress.moduleResults,
        reason: result.reason || '',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const logEntry = await appendRunLog({
        operation: 'report-fill',
        monitoringId,
        status: result.status,
        modules: result.completedModules || result.modules || [],
        moduleResults: result.moduleResults || [],
        filledFields: result.filledFields || 0,
        uploadedFiles: 0,
        saved: Boolean(result.saved),
        saveConfirmation: result.saveConfirmation || null,
        reason: result.reason || '',
        screenshot: result.screenshot || ''
      });

      sendJson(res, result.status === 'failed' ? 422 : 200, { ok: result.status !== 'failed', result, logEntry });
    } catch (error) {
      if (reportRunProgress?.runId === runId) {
        reportRunProgress = {
          ...reportRunProgress,
          status: 'failed',
          reason: error.message,
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      sendJson(res, 500, { ok: false, error: error.message, progress: reportRunProgress?.runId === runId ? reportRunProgress : null });
    } finally {
      isRunning = false;
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/general-description') {
    const body = await readJsonBody(req);
    const currentTemplate = await readLocalTemplate();
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    const template = {
      ...currentTemplate,
      monitoringId: body.monitoringId == null ? currentTemplate.monitoringId : String(body.monitoringId || '').trim(),
      fields: {
        ...currentTemplate.fields,
        generalDescription: String(fields.generalDescription || '').trim(),
        confidentialComments: String(fields.confidentialComments || '').trim()
      }
    };
    await writeLocalTemplate(template);
    const message = 'General Description 内容已保存到本机';
    const logEntry = await appendRunLog({
      operation: 'general-description-save',
      monitoringId: template.monitoringId,
      modules: ['General Description'],
      status: 'success',
      filledFields: Object.values(template.fields).filter((value) => String(value || '').trim()).length,
      uploadedFiles: 0,
      saved: true,
      message
    });
    sendJson(res, 200, { ok: true, message, logEntry });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/attachments/settings') {
    const body = await readJsonBody(req);
    const currentTemplate = await readLocalTemplate();
    const template = {
      ...currentTemplate,
      attachmentFolder: String(body.attachmentFolder || '').trim()
    };
    await writeLocalTemplate(template);
    const message = 'Report Attachments 文件夹设置已保存到本机';
    const logEntry = await appendRunLog({
      operation: 'attachment-settings-save',
      monitoringId: template.monitoringId,
      modules: ['Report Attachments'],
      status: 'success',
      filledFields: 0,
      uploadedFiles: 0,
      saved: true,
      message
    });
    sendJson(res, 200, { ok: true, message, logEntry });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/template') {
    const body = await readJsonBody(req);
    await writeLocalTemplate(normalizeTemplate(body));
    await writeCredentials(normalizeCredentials(body.credentials));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/credentials') {
    const body = await readJsonBody(req);
    const credentials = normalizeCredentials(body.credentials);
    if (!credentials.username || !credentials.password) {
      sendJson(res, 422, { ok: false, error: 'amfori username and password are required.' });
      return;
    }

    await writeCredentials(credentials);
    const message = '登录信息已写入本地文件';
    const logEntry = await appendRunLog({
      operation: 'credentials-save',
      modules: ['登录信息'],
      status: 'success',
      saved: true,
      message
    });
    sendJson(res, 200, { ok: true, message, logEntry });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/attachments/preview') {
    const body = await readJsonBody(req);
    const files = await previewAttachmentFiles(body.attachmentFolder);
    sendJson(res, 200, { ok: true, files });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/attachments/upload') {
    if (isRunning) {
      sendJson(res, 409, { ok: false, error: 'A task is already running.' });
      return;
    }

    isRunning = true;
    const body = await readJsonBody(req);
    const monitoringId = String(body.monitoringId || '').trim();
    const attachmentFolder = String(body.attachmentFolder || '').trim();
    const fileNames = Array.isArray(body.fileNames)
      ? body.fileNames.map((fileName) => String(fileName || '').trim()).filter(Boolean)
      : [];

    try {
      const mapping = await readJsonFile('config/field-mapping.json');
      const currentSettings = await readJsonFile('config/settings.json');
      const credentials = await readCredentials();
      const result = await runAmforiAttachmentUpload({
        monitoringId,
        attachmentFolder,
        fileNames,
        credentials,
        mapping,
        settings: currentSettings
      });

      const logEntry = await appendRunLog({
        operation: 'attachment-upload',
        monitoringId,
        status: result.status,
        modules: result.modules || ['Report Attachments'],
        filledFields: 0,
        uploadedFiles: result.uploadedFiles || 0,
        saved: Boolean(result.saved),
        saveConfirmation: result.saveConfirmation || null,
        reason: result.reason || '',
        screenshot: result.screenshot || ''
      });

      sendJson(res, result.status === 'success' ? 200 : 422, {
        ok: result.status === 'success',
        result,
        logEntry
      });
    } finally {
      isRunning = false;
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (isRunning) {
      sendJson(res, 409, { ok: false, error: 'A task is already running.' });
      return;
    }

    isRunning = true;
    const body = await readJsonBody(req);
    const template = normalizeTemplate(body);
    const credentials = normalizeCredentials(body.credentials);

    try {
      const mapping = await readJsonFile('config/field-mapping.json');
      const currentSettings = await readJsonFile('config/settings.json');
      await writeLocalTemplate(template);
      await writeCredentials(credentials);

      const result = await runAmforiAutomation({
        template: { ...template, credentials },
        mapping,
        settings: currentSettings
      });

      const logEntry = await appendRunLog({
        operation: 'form-fill',
        monitoringId: template.monitoringId,
        status: result.status,
        modules: result.modules || ['General Description', 'Report', 'Report Attachments'],
        filledFields: result.filledFields || 0,
        uploadedFiles: result.uploadedFiles || 0,
        saved: Boolean(result.saved),
        saveConfirmation: result.saveConfirmation || null,
        reason: result.reason || '',
        screenshot: result.screenshot || ''
      });

      sendJson(res, result.status === 'success' ? 200 : 422, {
        ok: result.status === 'success',
        result,
        logEntry
      });
    } finally {
      isRunning = false;
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'API route not found.' });
}

function normalizeTemplate(body) {
  return {
    monitoringId: String(body.monitoringId || '').trim(),
    attachmentFolder: String(body.attachmentFolder || '').trim(),
    fields: {
      ...(body.fields || {})
    }
  };
}

async function readCredentials() {
  try {
    const credentials = normalizeCredentials(await readJsonFile('.runtime/credentials.json'));
    if (credentials.username && credentials.password) {
      return credentials;
    }
  } catch {
  }
  return normalizeCredentials({
    username: process.env.AMFORI_USERNAME,
    password: process.env.AMFORI_PASSWORD
  });
}

async function writeCredentials(credentials) {
  await writeJsonFile('.runtime/credentials.json', normalizeCredentials(credentials));
}

async function previewAttachmentFiles(folderPath) {
  const folder = String(folderPath || '').trim();
  if (!folder) {
    throw new Error('Attachment folder is required.');
  }

  const resolved = path.resolve(folder);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Attachment folder does not exist: ${folder}`);
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeCredentials(credentials = {}) {
  return {
    username: String(credentials.username || '').trim(),
    password: String(credentials.password || '').trim()
  };
}

async function serveStatic(req, res, url) {
  const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(content);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}
