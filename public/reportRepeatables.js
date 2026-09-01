export const REPEATABLE_ROW_COUNTS_KEY = '__repeatableRowCounts';

const REPEATABLE_GROUPS = {
  '02-data-validation': [
    {
      id: 'official-languages',
      label: '官方语言',
      seedKey: '02-data-validation__search_4',
      anchorKey: 'LanguagesatSiteOfficialLanguageFree-0-1',
      addButtonTexts: ['Add Another']
    }
  ],
  '03-social-performance-management': [
    { id: 'responsible-procedures', label: '程序负责人', seedKey: 'OverallSocPerformanceMngRSPProceduresName-0-0', addButtonTexts: ['Add Name'] },
    { id: 'responsible-remediation', label: '补救负责人', seedKey: 'OverallSocPerformanceMngRSPRemediationName-0-0', addButtonTexts: ['Add Name'] },
    { id: 'responsible-grievance', label: '申诉负责人', seedKey: 'OverallSocPerformanceMngRSPGrievanceName-0-0', addButtonTexts: ['Add Name'] },
    { id: 'worker-organizations', label: '工会组织', seedKey: 'FoAWorkerOrganizationsTradeUnionsName-0-0', addButtonTexts: ['Add Organization'] },
    { id: 'representatives', label: '工人/工会代表', seedKey: 'FoARepresentativesName-0-0', addButtonTexts: ['Add Name'] },
    { id: 'ohs-contacts', label: '医疗联系人', seedKey: 'OHSRSPOHSAccidentsName-0-0', addButtonTexts: ['Add Name'] }
  ],
  '04-production-and-employment-structure': [
    { id: 'production-departments', label: '生产部门', seedKey: 'ProdEmpStructureProductionStructureDepartment-0-0', addButtonTexts: ['Add Department'] },
    { id: 'migrant-worker-origins', label: '移民工来源地', seedKey: 'MigrantWorkerDomesticRegion-0-0', addButtonTexts: ['Add Another'] }
  ],
  '05-remuneration-and-working-hours': [
    { id: 'benefits', label: '福利/奖金', seedKey: 'BenefitsNonCBADetails-0-0', addButtonTexts: ['Add Another'] },
    { id: 'sampled-months', label: '工时抽样月份', seedKey: 'panelSampleDetailsWeeklyStandardWh-0-1', addButtonTexts: ['Add Another'] }
  ],
  '08-sampled-workers': [
    { id: 'sampled-workers', label: '员工', seedKey: 'SampledWorkerName-0-0', addButtonTexts: ['Add Another'] }
  ]
};

export function getRepeatableGroups(moduleId) {
  return REPEATABLE_GROUPS[moduleId] || [];
}

export function getRepeatableGroupForTable(moduleId, table) {
  return getRepeatableGroups(moduleId).find((group) =>
    (table.rows || []).some((row) => row.includes(group.seedKey))
  ) || null;
}

export function addRepeatableRow(values = {}, group, module) {
  const counts = { ...(values[REPEATABLE_ROW_COUNTS_KEY] || {}) };
  counts[group.id] = getRequiredRowCount(values, group, module) + 1;
  return { ...values, [REPEATABLE_ROW_COUNTS_KEY]: counts };
}

export function materializeRepeatableReportModule(module, values = {}) {
  const groups = getRepeatableGroups(module?.id);
  if (groups.length === 0) return module;

  const expanded = structuredClone(module);
  for (const group of groups) {
    materializeGroup(expanded, values, group);
  }
  return expanded;
}

function materializeGroup(module, values, group) {
  const table = findTableBySeedKey(module.layout || [], group.seedKey);
  if (!table || table.rows.length === 0) return;

  const fieldByKey = new Map(module.fields.map((field) => [field.key, field]));
  const baseRow = table.rows[0];
  const baseFields = baseRow.map((key) => fieldByKey.get(key)).filter(Boolean);
  const anchor = fieldByKey.get(group.anchorKey || group.seedKey) || baseFields.find((field) => field.selector);
  if (!anchor || baseFields.length === 0) return;

  const existingRows = table.rows.length;
  decorateExistingRows(table.rows, fieldByKey, group, anchor);
  const requiredRows = getRequiredRowCount(values, group, module, table);
  if (requiredRows <= existingRows) return;

  const sourceRowIndex = getFieldRowIndex(anchor.key) ?? 0;
  const uiSelectStride = getUiSelectStride(table.rows, fieldByKey, baseRow);
  const maxOrder = Math.max(...module.fields.map((field) => Number(field.order || 0)));
  const addedRowCount = requiredRows - existingRows;
  const lastExistingOrder = Math.max(...table.rows.flatMap((row) => row.map((key) => Number(fieldByKey.get(key)?.order || 0))));

  for (let rowIndex = existingRows; rowIndex < requiredRows; rowIndex += 1) {
    const replacements = new Map();
    const clonedRow = [];
    for (let cellIndex = 0; cellIndex < baseRow.length; cellIndex += 1) {
      const sourceField = fieldByKey.get(baseRow[cellIndex]);
      if (!sourceField) {
        clonedRow.push(null);
        continue;
      }
      const cloned = cloneRepeatableField(sourceField, {
        moduleId: module.id,
        group,
        rowIndex,
        sourceRowIndex,
        cellIndex,
        uiSelectStride,
        maxOrder
      });
      replacements.set(sourceField.key, cloned.key);
      module.fields.push(cloned);
      fieldByKey.set(cloned.key, cloned);
      clonedRow.push(cloned.key);
    }
    table.rows.push(clonedRow);
  }

  const addedUiSelects = baseFields.filter((field) => field.type === 'ui-select').length * addedRowCount;
  if (addedUiSelects > 0) {
    for (const field of module.fields) {
      if (field.type === 'ui-select' && field.repeatable?.groupId !== group.id && Number(field.order || 0) > lastExistingOrder) {
        field.uiSelectIndex = Number(field.uiSelectIndex || 0) + addedUiSelects;
      }
    }
  }
  decorateExistingRows(table.rows, fieldByKey, group, anchor);
}

function decorateExistingRows(rows, fieldByKey, group, anchor) {
  const anchorRowIndex = getFieldRowIndex(anchor.key) ?? 0;
  for (let rowOffset = 0; rowOffset < rows.length; rowOffset += 1) {
    const rowIndex = anchorRowIndex + rowOffset;
    const anchorField = rows[rowOffset]
      .map((key) => fieldByKey.get(key))
      .find((field) => field && (field.key === anchor.key || field.key.startsWith(getFieldPrefix(anchor.key))));
    const anchorSelector = anchorField?.selector || replaceFieldRowIndex(anchor.selector, anchorRowIndex, rowIndex);
    for (const key of rows[rowOffset]) {
      const field = fieldByKey.get(key);
      if (!field) continue;
      field.repeatable = {
        groupId: group.id,
        groupLabel: group.label,
        rowIndex,
        anchorSelector,
        addButtonTexts: group.addButtonTexts
      };
    }
  }
}

function getRequiredRowCount(values, group, module, table) {
  const savedCount = Number(values[REPEATABLE_ROW_COUNTS_KEY]?.[group.id] || 0);
  const legacySampledWorkerCount = group.id === 'sampled-workers' ? Number(values.__sampledWorkerRowCount || 0) : 0;
  let requiredRows = Math.max(table?.rows?.length || 1, savedCount, legacySampledWorkerCount);
  const seedField = module.fields.find((field) => field.key === group.anchorKey || field.key === group.seedKey);
  const rowPattern = seedField ? getFieldRowPattern(seedField.key) : null;

  for (const key of Object.keys(values)) {
    const directMatch = rowPattern?.exec(key);
    const generatedMatch = key.match(new RegExp(`^${escapeRegex(module.id)}__repeatable__${escapeRegex(group.id)}__row-(\\d+)__select-\\d+$`));
    const legacyGeneratedMatch = group.id === 'sampled-workers'
      ? key.match(/^08-sampled-workers__row-(\d+)__select-\d+$/)
      : null;
    if (directMatch) requiredRows = Math.max(requiredRows, Number(directMatch[1]) + 1);
    if (generatedMatch) requiredRows = Math.max(requiredRows, Number(generatedMatch[1]) + 1);
    if (legacyGeneratedMatch) requiredRows = Math.max(requiredRows, Number(legacyGeneratedMatch[1]) + 1);
  }
  return requiredRows;
}

function cloneRepeatableField(field, context) {
  const cloned = structuredClone(field);
  if (field.type === 'ui-select') {
    cloned.key = `${context.moduleId}__repeatable__${context.group.id}__row-${context.rowIndex}__select-${context.cellIndex}`;
    cloned.uiSelectIndex = Number(field.uiSelectIndex || 0) + context.rowIndex * context.uiSelectStride;
  } else {
    cloned.key = replaceFieldRowIndex(field.key, context.sourceRowIndex, context.rowIndex);
  }
  cloned.name = replaceFieldRowIndex(field.name, context.sourceRowIndex, context.rowIndex);
  cloned.selector = replaceFieldRowIndex(field.selector, context.sourceRowIndex, context.rowIndex);
  cloned.xpathFallback = replaceFieldRowIndex(field.xpathFallback, context.sourceRowIndex, context.rowIndex);
  cloned.order = context.maxOrder + context.rowIndex * 100 + context.cellIndex;
  return cloned;
}

function getUiSelectStride(rows, fieldByKey, baseRow) {
  const firstRowIndexes = baseRow.map((key) => Number(fieldByKey.get(key)?.uiSelectIndex)).filter(Number.isFinite);
  if (firstRowIndexes.length === 0) return 0;
  if (rows.length < 2) return firstRowIndexes.length;

  const secondRow = rows[1];
  for (let cellIndex = 0; cellIndex < baseRow.length; cellIndex += 1) {
    const first = fieldByKey.get(baseRow[cellIndex]);
    const second = fieldByKey.get(secondRow[cellIndex]);
    if (first?.type === 'ui-select' && second?.type === 'ui-select') {
      const stride = Number(second.uiSelectIndex) - Number(first.uiSelectIndex);
      if (Number.isFinite(stride) && stride > 0) return stride;
    }
  }
  return firstRowIndexes.length;
}

function findTableBySeedKey(blocks, seedKey) {
  for (const block of blocks) {
    if (block.type === 'table' && (block.rows || []).some((row) => row.includes(seedKey))) return block;
    const nested = findTableBySeedKey(block.children || [], seedKey);
    if (nested) return nested;
  }
  return null;
}

function getFieldRowIndex(key) {
  const match = String(key || '').match(/-(\d+)-(\d+)(?=-|$)/);
  return match ? Number(match[1]) : null;
}

function replaceFieldRowIndex(value, sourceRowIndex, targetRowIndex) {
  if (typeof value !== 'string') return value;
  return value.replace(/-(\d+)-(\d+)(?=-|$)/g, (whole, rowIndex, columnIndex) =>
    Number(rowIndex) === sourceRowIndex ? `-${targetRowIndex}-${columnIndex}` : whole
  );
}

function getFieldPrefix(key) {
  return String(key || '').replace(/-\d+-\d+(?=-|$).*/, '');
}

function getFieldRowPattern(key) {
  const text = String(key || '');
  const match = text.match(/^(.*?)-(\d+)-(\d+)(?=-|$)(.*)$/);
  if (!match) return null;
  return new RegExp(`^${escapeRegex(match[1])}-(\\d+)-${escapeRegex(match[3])}${escapeRegex(match[4])}$`);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
