/**
 * validate-report-schema.mjs
 *
 * 字段集不变性校验：重建后的模块 schema 与原始采集快照一致，且 layout 引用合法。
 * 用法：node scripts/validate-report-schema.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const raw = JSON.parse(await fs.readFile(path.join(root, 'data', 'report_schema.json'), 'utf8'));
const builtIndex = JSON.parse(await fs.readFile(path.join(root, 'data', 'report-schema', 'index.json'), 'utf8'));

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}
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

const problems = [];
let totalRaw = 0;
let totalBuilt = 0;
let modulesWithLayout = 0;

if (raw.modules.length !== builtIndex.modules.length) {
  problems.push(`module count mismatch: raw=${raw.modules.length} built=${builtIndex.modules.length}`);
}

for (let i = 0; i < raw.modules.length; i++) {
  const rawModule = raw.modules[i];
  const builtMeta = builtIndex.modules[i];
  if (!builtMeta) continue;
  const fileName = builtMeta.file.split('/').pop();
  const builtModule = JSON.parse(await fs.readFile(path.join(root, 'data', 'report-schema', 'modules', fileName), 'utf8'));

  const slug = `${String(i + 1).padStart(2, '0')}-${slugify(rawModule.title)}`;
  // 与 build-report-schema.mjs 相同的 key 生成规则（用原始 fieldIndex，而非过滤后的下标）
  const rawFields = [];
  const rawKeys = new Set();
  for (const [fieldIndex, f] of (rawModule.fields || []).entries()) {
    if (isNavigationOrHelper(f)) continue;
    rawFields.push(f);
    rawKeys.add(f.id || `${slug}__${f.type || f.tagName}_${fieldIndex}`);
  }
  const builtFields = builtModule.fields || [];
  totalRaw += rawFields.length;
  totalBuilt += builtFields.length;

  if (rawFields.length !== builtFields.length) {
    problems.push(`[${slug}] field count: raw=${rawFields.length} built=${builtFields.length}`);
  }

  // key set 一致性
  const builtKeys = new Set(builtFields.map((f) => f.key));
  const missing = [...rawKeys].filter((k) => !builtKeys.has(k));
  const extra = [...builtKeys].filter((k) => !rawKeys.has(k));
  if (missing.length) problems.push(`[${slug}] ${missing.length} keys missing from built schema (e.g. ${missing.slice(0, 3).join(', ')})`);
  if (extra.length) problems.push(`[${slug}] ${extra.length} extra keys in built schema`);

  // selector/type 不变性（按原始顺序比对）
  const uiSelectCountRaw = rawFields.filter((f) => f.type === 'search').length;
  let uiSelectIdx = 0;
  for (let k = 0; k < rawFields.length && k < builtFields.length; k++) {
    const r = rawFields[k];
    const b = builtFields[k];
    if (b.selector !== (r.selector || '')) problems.push(`[${slug}] selector changed for field #${k} (${r.id})`);
    if (b.type !== normalizeType(r)) problems.push(`[${slug}] type changed for field #${k} (${r.id}): raw=${normalizeType(r)} built=${b.type}`);
    if (b.type === 'ui-select' && b.uiSelectIndex !== uiSelectIdx) problems.push(`[${slug}] uiSelectIndex mismatch for field #${k}`);
    if (b.type === 'ui-select') uiSelectIdx += 1;
  }
  if (uiSelectIdx !== uiSelectCountRaw) problems.push(`[${slug}] ui-select count: raw=${uiSelectCountRaw} built=${uiSelectIdx}`);

  // layout 引用合法性
  if (Array.isArray(builtModule.layout) && builtModule.layout.length > 0) {
    modulesWithLayout += 1;
    const builtKeySet = new Set(builtFields.map((f) => f.key));
    const refs = [];
    (function walk(blocks) {
      for (const blk of blocks) {
        if (blk.type === 'field') refs.push(blk.key);
        else if (blk.type === 'field-group') refs.push(...(blk.optionKeys || []));
        else if (blk.type === 'group') walk(blk.children || []);
      }
    })(builtModule.layout);
    const badRefs = refs.filter((k) => !builtKeySet.has(k));
    if (badRefs.length) problems.push(`[${slug}] ${badRefs.length} layout refs not found (e.g. ${badRefs.slice(0, 3).join(', ')})`);
  }
}

console.log(`Modules: ${raw.modules.length} (${modulesWithLayout} with layout)`);
console.log(`Fields: raw=${totalRaw} built=${totalBuilt}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
} else {
  console.log('✅ 字段集不变性校验通过：模块数、字段数、key 集合、selector/type/uiSelectIndex、layout 引用均一致。');
}
