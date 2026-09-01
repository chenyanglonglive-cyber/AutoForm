import { readJsonFile, writeJsonFile } from './storage.js';

const shippedTemplatePath = 'data/templates/default.json';
const localTemplatePath = 'data/templates/local-default.json';

export async function ensureLocalTemplate() {
  try {
    await readJsonFile(localTemplatePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const shippedTemplate = await readJsonFile(shippedTemplatePath);
    await writeJsonFile(localTemplatePath, normalizeTemplate(shippedTemplate));
  }
}

export async function readLocalTemplate() {
  await ensureLocalTemplate();
  return normalizeTemplate(await readJsonFile(localTemplatePath));
}

export async function writeLocalTemplate(template) {
  await writeJsonFile(localTemplatePath, normalizeTemplate(template));
}

export const LOCAL_TEMPLATE_PATH = localTemplatePath;

function normalizeTemplate(template = {}) {
  return {
    monitoringId: String(template.monitoringId || '').trim(),
    attachmentFolder: String(template.attachmentFolder || '').trim(),
    fields: { ...(template.fields || {}) }
  };
}
