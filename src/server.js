import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendRunLog,
  ensureRuntimeFiles,
  readJsonFile,
  readRecentLogs,
  resolveFromRoot,
  writeJsonFile
} from './storage.js';
import { runAmforiAutomation } from './automation/amforiBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');

let isRunning = false;

await ensureRuntimeFiles();

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
  if (req.method === 'GET' && url.pathname === '/api/template') {
    const template = await readJsonFile('data/templates/default.json');
    const mapping = await readJsonFile('config/field-mapping.json');
    sendJson(res, 200, { ok: true, template, mapping });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    const limit = Number(url.searchParams.get('limit') || 50);
    const logs = await readRecentLogs(limit);
    sendJson(res, 200, { ok: true, logs });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/template') {
    const body = await readJsonBody(req);
    await writeJsonFile('data/templates/default.json', normalizeTemplate(body));
    sendJson(res, 200, { ok: true });
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

    try {
      const mapping = await readJsonFile('config/field-mapping.json');
      const currentSettings = await readJsonFile('config/settings.json');
      await writeJsonFile('data/templates/default.json', template);

      const result = await runAmforiAutomation({
        template,
        mapping,
        settings: currentSettings
      });

      const logEntry = await appendRunLog({
        monitoringId: template.monitoringId,
        status: result.status,
        modules: result.modules || ['General Description', 'Report', 'Report Attachments'],
        filledFields: result.filledFields || 0,
        uploadedFiles: result.uploadedFiles || 0,
        saved: Boolean(result.saved),
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
