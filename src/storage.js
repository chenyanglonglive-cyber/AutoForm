import { promises as fs } from 'node:fs';
import path from 'node:path';

export const rootDir = process.cwd();

export function resolveFromRoot(...parts) {
  return path.resolve(rootDir, ...parts);
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureRuntimeFiles() {
  await ensureDir(resolveFromRoot('data'));
  await ensureDir(resolveFromRoot('data', 'templates'));
  await ensureDir(resolveFromRoot('data', 'screenshots'));
  await ensureDir(resolveFromRoot('.runtime'));

  await ensureFile(resolveFromRoot('data', 'run-logs.jsonl'), '');
}

export async function ensureFile(filePath, defaultContent) {
  try {
    await fs.access(filePath);
  } catch {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, defaultContent, 'utf8');
  }
}

export async function readJsonFile(relativePath) {
  const filePath = resolveFromRoot(relativePath);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJsonFile(relativePath, value) {
  const filePath = resolveFromRoot(relativePath);
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function appendRunLog(entry) {
  const filePath = resolveFromRoot('data', 'run-logs.jsonl');
  const safeEntry = {
    time: new Date().toISOString(),
    ...entry
  };
  await fs.appendFile(filePath, `${JSON.stringify(safeEntry)}\n`, 'utf8');
  return safeEntry;
}

export async function readRecentLogs(limit = 50) {
  const filePath = resolveFromRoot('data', 'run-logs.jsonl');
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { status: 'invalid-log-line', raw: line };
      }
    })
    .reverse();
}

export async function listFilesInFolder(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(folderPath, entry.name));
}
