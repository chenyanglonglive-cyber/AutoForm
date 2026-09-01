import { readJsonFile } from './storage.js';
import { readLocalTemplate } from './localTemplateStorage.js';

const settings = await readJsonFile('config/settings.json');
const mapping = await readJsonFile('config/field-mapping.json');
const template = await readLocalTemplate();

assert(settings.server?.host, 'settings.server.host is required');
assert(settings.server?.port, 'settings.server.port is required');
assert(settings.amfori?.platformUrl, 'settings.amfori.platformUrl is required');
assert(settings.amfori?.todoUrl, 'settings.amfori.todoUrl is required');
assert(mapping.modules?.generalDescription, 'generalDescription module is required');
assert(mapping.modules?.report, 'report module is required');
assert(mapping.modules?.reportAttachments, 'reportAttachments module is required');
assert(mapping.modules.reportAttachments.attachmentSelector, 'attachment selector is required');
assert(mapping.saveButton?.selector, 'save button selector is required');
assert(template.fields && typeof template.fields === 'object', 'template.fields is required');

for (const [moduleKey, moduleConfig] of Object.entries(mapping.modules)) {
  assert(moduleConfig.tabText, `${moduleKey}.tabText is required`);
  for (const field of moduleConfig.fields || []) {
    assert(field.localKey, `${moduleKey} field localKey is required`);
    assert(field.label, `${moduleKey}.${field.localKey} label is required`);
    assert(field.type, `${moduleKey}.${field.localKey} type is required`);
    assert(field.selector || field.fallbackSelectors?.length, `${moduleKey}.${field.localKey} selector is required`);
  }
}

console.log('Configuration is valid.');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
