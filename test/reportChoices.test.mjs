import assert from 'node:assert/strict';
import test from 'node:test';
import { isCheckedTemplateValue, normalizeExclusiveChoiceValues } from '../public/reportChoices.js';

test('does not treat the string false as a selected choice', () => {
  assert.equal(isCheckedTemplateValue('false'), false);
  assert.equal(isCheckedTemplateValue(false), false);
  assert.equal(isCheckedTemplateValue('true'), true);
  assert.equal(isCheckedTemplateValue(true), true);
});

test('normalizes one legacy radio selection to booleans', () => {
  const values = { yes: 'true', no: 'false' };
  const result = normalizeExclusiveChoiceValues(values, ['yes', 'no']);

  assert.deepEqual(values, { yes: true, no: false });
  assert.deepEqual(result, { selectedKey: 'yes', conflicted: false, changed: true });
});

test('clears an invalid radio group with multiple selected values', () => {
  const values = { yes: true, no: 'true', undisclosed: false };
  const result = normalizeExclusiveChoiceValues(values, ['yes', 'no', 'undisclosed']);

  assert.deepEqual(values, { yes: false, no: false, undisclosed: false });
  assert.deepEqual(result, { selectedKey: '', conflicted: true, changed: true });
});
