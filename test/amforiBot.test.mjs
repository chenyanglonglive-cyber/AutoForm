import assert from 'node:assert/strict';
import test from 'node:test';
import { getReportFieldsToFill } from '../src/automation/amforiBot.js';
import remunerationModule from '../data/report-schema/modules/05-remuneration-and-working-hours.json' with { type: 'json' };

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
