import assert from 'node:assert/strict';
import test from 'node:test';
import { addRepeatableRow, materializeRepeatableReportModule } from '../public/reportRepeatables.js';
import module from '../data/report-schema/modules/08-sampled-workers.json' with { type: 'json' };
import socialModule from '../data/report-schema/modules/03-social-performance-management.json' with { type: 'json' };
import productionModule from '../data/report-schema/modules/04-production-and-employment-structure.json' with { type: 'json' };
import remunerationModule from '../data/report-schema/modules/05-remuneration-and-working-hours.json' with { type: 'json' };

test('adds sampled-worker fields and rows beyond the five schema rows', () => {
  const template = addRepeatableRow({ __repeatableRowCounts: { 'sampled-workers': 6 } }, {
    id: 'sampled-workers'
  }, module);
  const expanded = materializeRepeatableReportModule(module, {
    ...template,
    __repeatableRowCounts: { 'sampled-workers': 7 },
    'SampledWorkerName-6-0': 'Worker 7'
  });

  assert.ok(expanded.fields.some((field) => field.key === 'SampledWorkerName-6-0'));
  assert.ok(expanded.fields.some((field) => field.key === '08-sampled-workers__repeatable__sampled-workers__row-6__select-1'));
  assert.equal(expanded.layout[1].children[0].rows.length, 7);
});

test('expands each feedback-table group without changing the original schema', () => {
  const social = materializeRepeatableReportModule(socialModule, {
    __repeatableRowCounts: { representatives: 4, 'worker-organizations': 2 }
  });
  const production = materializeRepeatableReportModule(productionModule, {
    __repeatableRowCounts: { 'production-departments': 3, 'migrant-worker-origins': 2 }
  });
  const remuneration = materializeRepeatableReportModule(remunerationModule, {
    __repeatableRowCounts: { benefits: 3, 'sampled-months': 4 }
  });

  assert.ok(social.fields.some((field) => field.key === 'FoARepresentativesTitle-3-0'));
  assert.ok(social.fields.some((field) => field.key === 'FoAWorkerOrganizationsTradeUnionsName-1-0'));
  assert.ok(production.fields.some((field) => field.key === 'ProdEmpStructureProductionStructureDepartment-2-0'));
  assert.ok(production.fields.some((field) => field.key === 'MigrantWorkerDomesticRegion-1-0'));
  assert.ok(remuneration.fields.some((field) => field.key === 'BenefitsNonCBADetails-2-0'));
  assert.ok(remuneration.fields.some((field) => field.key === 'panelSampleDetailsWeeklyStandardWh-3-1'));
  assert.equal(socialModule.fields.some((field) => field.key === 'FoARepresentativesTitle-3-0'), false);
});
