import path from 'node:path';
import { readJsonFile, writeJsonFile } from './storage.js';

const indexPath = 'data/report-schema/index.json';
const importedTemplatePath = 'data/templates/report-imported.json';

export async function readReportIndex() {
  return readJsonFile(indexPath);
}

export async function readReportModule(moduleId) {
  const index = await readReportIndex();
  const entry = index.modules.find((module) => module.id === moduleId);
  if (!entry) {
    throw new Error(`Unknown Report module: ${moduleId}`);
  }

  return readJsonFile(path.posix.join('data/report-schema', entry.file));
}

export async function readReportTemplate() {
  try {
    return await readJsonFile(importedTemplatePath);
  } catch {
    return { version: 1, modules: {} };
  }
}

export async function writeReportTemplate(template) {
  await writeJsonFile(importedTemplatePath, {
    version: 1,
    modules: template?.modules && typeof template.modules === 'object' ? template.modules : {}
  });
}
