import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fillReportModuleFields,
  getMissingTemplateRequiredFields,
  getReportFieldsToFill
} from '../src/automation/amforiBot.js';
import remunerationModule from '../data/report-schema/modules/05-remuneration-and-working-hours.json' with { type: 'json' };
import dataValidationModule from '../data/report-schema/modules/02-data-validation.json' with { type: 'json' };

const sourceField = '05-remuneration-and-working-hours__search_19';
const conditionalKeys = [
  'LivingWagePleaseaddthelinkofGlwCSource',
  'CalculatedLivingWagePleaseEnterMonthAndYearGlwc-month',
  'CalculatedLivingWagePleaseEnterMonthAndYearGlwc-year'
];

test('skips GLWC-only fields when the data source does not make them visible', () => {
  const values = {
    [sourceField]: '',
    LivingWagePleaseaddthelinkofGlwCSource: 'https://example.test/glwc',
    'CalculatedLivingWagePleaseEnterMonthAndYearGlwc-month': 'string:09',
    'CalculatedLivingWagePleaseEnterMonthAndYearGlwc-year': '2024'
  };
  const result = getReportFieldsToFill(values, remunerationModule.fields);

  assert.deepEqual(result.fieldsToFill, []);
  assert.deepEqual(result.skippedConditionalFields.map((field) => field.key), conditionalKeys);
});

test('fills GLWC-only fields after GLWC website is selected', () => {
  const values = {
    [sourceField]: 'GLWC website',
    LivingWagePleaseaddthelinkofGlwCSource: 'https://example.test/glwc',
    'CalculatedLivingWagePleaseEnterMonthAndYearGlwc-month': 'string:09',
    'CalculatedLivingWagePleaseEnterMonthAndYearGlwc-year': '2024'
  };
  const result = getReportFieldsToFill(values, remunerationModule.fields);

  assert.deepEqual(result.fieldsToFill.map((field) => field.key), [sourceField, ...conditionalKeys]);
  assert.deepEqual(result.skippedConditionalFields, []);
});

test('the Sample Details month selector contains every month', () => {
  const field = remunerationModule.fields.find((item) => item.key === '05-remuneration-and-working-hours__search_47');
  assert.deepEqual(field.options.map((option) => option.value), [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]);
});

test('skips NA in the optional official-language fallback field', () => {
  const values = { 'LanguagesatSiteOfficialLanguageFree-0-1': 'NA' };
  const result = getReportFieldsToFill(values, dataValidationModule.fields);
  assert.deepEqual(result.fieldsToFill, []);
  assert.deepEqual(result.skippedConditionalFields.map((field) => field.key), [
    'LanguagesatSiteOfficialLanguageFree-0-1'
  ]);
});

test('fills the current repeatable row before preparing the next row', async () => {
  const events = [];
  const fields = [
    { key: 'row-0', repeatable: { rowIndex: 0 } },
    { key: 'row-1', repeatable: { rowIndex: 1 } }
  ];
  const filled = await fillReportModuleFields(null, {}, fields, {
    'row-0': 'first',
    'row-1': 'second'
  }, () => {}, {
    ensureFieldRow: async (_page, _module, currentFields) => events.push(`ensure:${currentFields[0].key}`),
    fillField: async (_page, field) => events.push(`fill:${field.key}`)
  });

  assert.equal(filled, 2);
  assert.deepEqual(events, ['ensure:row-0', 'fill:row-0', 'ensure:row-1', 'fill:row-1']);
});

test('reports required values only for populated repeatable rows', () => {
  const fields = [
    { key: 'interpreter', label: 'Interpreter used', templateRequired: 'module' },
    { key: 'type-0', label: 'Interview type', templateRequired: 'repeatable-row', repeatable: { groupId: 'details', rowIndex: 0 } },
    { key: 'notes-0', label: 'Notes', repeatable: { groupId: 'details', rowIndex: 0 } },
    { key: 'type-1', label: 'Interview type', templateRequired: 'repeatable-row', repeatable: { groupId: 'details', rowIndex: 1 } },
    { key: 'notes-1', label: 'Notes', repeatable: { groupId: 'details', rowIndex: 1 } }
  ];
  const missing = getMissingTemplateRequiredFields({ 'notes-0': 'first interview' }, fields);

  assert.deepEqual(missing.map((field) => field.key), ['interpreter', 'type-0']);
});
