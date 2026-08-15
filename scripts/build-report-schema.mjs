import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rawPath = path.join(root, 'data', 'report_schema.json');
const outputDir = path.join(root, 'data', 'report-schema');
const modulesDir = path.join(outputDir, 'modules');
const templatePath = path.join(root, 'data', 'templates', 'report-imported.json');
const layoutIndexPath = path.join(root, 'data', 'report-layout', 'index.json');
const layoutModulesDir = path.join(root, 'data', 'report-layout', 'modules');

const raw = JSON.parse(await fs.readFile(rawPath, 'utf8'));
await fs.mkdir(modulesDir, { recursive: true });

let layoutIndex = null;
try { layoutIndex = JSON.parse(await fs.readFile(layoutIndexPath, 'utf8')); } catch {}

// ui-select 候选选项（按数据源去重后的 sources + 每模块映射）
const optionsPath = path.join(root, 'data', 'report-layout', 'options.json');
let optionsStore = { sources: {}, mapping: {} };
try { optionsStore = JSON.parse(await fs.readFile(optionsPath, 'utf8')); } catch {}
const uiSelectLabelsPath = path.join(root, 'data', 'report-layout', 'ui-select-labels.json');
let uiSelectLabels = { modules: {} };
try { uiSelectLabels = JSON.parse(await fs.readFile(uiSelectLabelsPath, 'utf8')); } catch {}

const importedValues = { version: 1, modules: {} };
const index = [];

for (const [moduleIndex, sourceModule] of raw.modules.entries()) {
  const slug = `${String(moduleIndex + 1).padStart(2, '0')}-${slugify(sourceModule.title)}`;
  const fields = [];
  const uiSelectFieldsByIndex = {};
  let uiSelectIndex = 0;

  for (const [fieldIndex, sourceField] of (sourceModule.fields || []).entries()) {
    if (isNavigationOrHelper(sourceField)) {
      continue;
    }

    const key = sourceField.id || `${slug}__${sourceField.type || sourceField.tagName}_${fieldIndex}`;
    const type = normalizeType(sourceField);
    const schemaField = {
      key,
      type,
      order: fieldIndex,
      label: sourceField.labelText || sourceField.ariaLabel || sourceField.placeholder || key,
      name: sourceField.name || '',
      selector: sourceField.selector || '',
      xpathFallback: sourceField.xpathFallback || '',
      required: Boolean(sourceField.required),
      disabled: Boolean(sourceField.disabled),
      readOnly: Boolean(sourceField.readOnly),
      options: (sourceField.options || []).map(({ value, label }) => ({ value, label })),
      groupValues: (sourceField.groupValues || []).map(({ value, label }) => ({ value, label }))
    };

    if (type === 'ui-select') {
      schemaField.uiSelectIndex = uiSelectIndex;
      uiSelectFieldsByIndex[uiSelectIndex] = schemaField;
      uiSelectIndex += 1;
    }

    fields.push(schemaField);

    importedValues.modules[slug] ??= {};
    importedValues.modules[slug][key] = extractValue(sourceField, type);
  }

  // 读取布局（采集产物）
  let layout = [];
  if (layoutIndex) {
    const layoutEntry = layoutIndex.modules?.find((m) => m.id === slug);
    if (layoutEntry) {
      try {
        const layoutModule = JSON.parse(await fs.readFile(path.join(layoutModulesDir, `${slug}.json`), 'utf8'));
        layout = resolveLayout(layoutModule.layout || [], fields, uiSelectFieldsByIndex);
      } catch {}
    }
  }

  // 回填 ui-select 候选选项（按数据源去重后的 sources）并标记 optionsStatus
  const moduleMapping = optionsStore.mapping?.[slug] || {};
  for (const [idx, uiField] of Object.entries(uiSelectFieldsByIndex)) {
    const collectedLabel = String(uiSelectLabels.modules?.[slug]?.[String(idx)] || '').trim();
    if (collectedLabel && collectedLabel.toLowerCase() !== 'select box') {
      uiField.label = collectedLabel;
    }
    const srcKey = moduleMapping[String(idx)];
    const src = srcKey ? optionsStore.sources?.[srcKey] : null;
    if (src && src.status === 'complete' && Array.isArray(src.options) && src.options.length) {
      uiField.options = src.options;
      uiField.optionsStatus = 'complete';
    } else {
      uiField.optionsStatus = (src && src.status) || 'unavailable';
    }
  }

  const module = {
    id: slug,
    title: sourceModule.title,
    sectionOrder: moduleIndex,
    layout,
    tables: sanitizeTables(sourceModule.tables || []),
    fields
  };

  await fs.writeFile(path.join(modulesDir, `${slug}.json`), `${JSON.stringify(module, null, 2)}\n`, 'utf8');
  index.push({ id: slug, title: sourceModule.title, fieldCount: fields.length, file: `modules/${slug}.json` });
}

await fs.writeFile(path.join(outputDir, 'index.json'), `${JSON.stringify({ version: 1, modules: index }, null, 2)}\n`, 'utf8');
await fs.writeFile(templatePath, `${JSON.stringify(importedValues, null, 2)}\n`, 'utf8');

function isNavigationOrHelper(field) {
  return field.id === 'currentsection' || field.id?.startsWith('focusser-') || field.disabled || field.readOnly;
}

function normalizeType(field) {
  if (field.type === 'search') return 'ui-select';
  if (field.tagName === 'select' || field.type === 'select') return 'select';
  if (field.type === 'radio' || field.type === 'checkbox') return field.type;
  if (field.tagName === 'textarea') return 'textarea';
  return field.type || 'text';
}

function extractValue(field, type) {
  if (type === 'checkbox' || type === 'radio') {
    // 按本字段 value 匹配同 value 项的 checked，避免 groupValues.some(checked) 把整组标 true
    return Boolean(field.groupValues?.find((option) => option.value === field.value && option.checked));
  }
  return field.value ?? '';
}

function resolveLayout(blocks, fields, uiSelectFieldsByIndex) {
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  return blocks
    .map((b) => {
      if (b.type === 'group') {
        return { type: 'group', title: b.title, collapsed: Boolean(b.collapsed), children: resolveLayout(b.children || [], fields, uiSelectFieldsByIndex) };
      }
      if (b.type === 'field') {
        if (b.id != null && b.id !== '' && fieldByKey.has(b.id)) return { type: 'field', key: b.id };
        if (b.uiSelectIndex != null && uiSelectFieldsByIndex[b.uiSelectIndex]) return { type: 'field', key: uiSelectFieldsByIndex[b.uiSelectIndex].key };
        return null;
      }
      if (b.type === 'field-group') {
        const optionKeys = (b.optionKeys || []).filter((k) => fieldByKey.has(k));
        return { type: 'field-group', controlType: b.controlType, label: b.label || '', optionKeys };
      }
      if (b.type === 'table') {
        return resolveTableBlock(b, fieldByKey, uiSelectFieldsByIndex);
      }
      return b; // help / heading 等原样保留
    })
    .filter(Boolean);
}

function sanitizeTables(tables) {
  return tables.map((table) => ({
    headers: table.headers || [],
    rowCount: Number(table.rowCount || 0),
    sampleRows: (table.sampleRows || []).map((row) => row.map((cell) => ({
      type: cell.type || '',
      inputType: cell.inputType || '',
      name: cell.name || '',
      id: cell.id || ''
    }))),
    className: table.className || ''
  }));
}

// 把布局采集到的表格块解析为可渲染模型：每个单元格引用（{ id } 或 { uiSelectIndex }）解析为最终 field.key。
// 无 id 的 ui-select 通过采集时记录的 uiSelectIndex 绑定回原单元格；无法定位的单元格置 null（渲染器渲染为空列）。
function resolveTableBlock(b, fieldByKey, uiSelectFieldsByIndex) {
  const resolveCell = (cell) => {
    if (!cell) return null;
    if (cell.id != null && cell.id !== '' && fieldByKey.has(cell.id)) return cell.id;
    if (cell.uiSelectIndex != null && uiSelectFieldsByIndex[cell.uiSelectIndex]) return uiSelectFieldsByIndex[cell.uiSelectIndex].key;
    return null;
  };
  const rows = (b.rows || [])
    .map((row) => (row || []).map(resolveCell))
    .filter((row) => row.some((key) => key != null));

  // 表头：优先用采集到的 thead th；为空则用首行字段 label 推导（尽力给出可辨认列名）。
  let headers = (b.headers || []).map((h) => String(h ?? '').trim()).filter(Boolean);
  if (headers.length === 0) {
    const firstRow = rows[0] || [];
    headers = firstRow.map((key) => (key != null && fieldByKey.get(key) ? (fieldByKey.get(key).label || '') : ''));
  }
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  while (headers.length < colCount) headers.push('');

  return { type: 'table', title: b.title || '', headers, rowCount: Number(b.rowCount || rows.length), rows };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}
