import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { chromium } from 'playwright';
import { materializeRepeatableReportModule } from '../public/reportRepeatables.js';
import { fillReportModuleFields, fillReportField, getReportFieldsToFill, verifyReportModule, locateRepeatableAddButton, openReportIndex } from '../src/automation/amforiBot.js';
import interviewSchema from '../data/report-schema/modules/10-interview-evidence.json' with { type: 'json' };
import productionSchema from '../data/report-schema/modules/04-production-and-employment-structure.json' with { type: 'json' };
import remunerationSchema from '../data/report-schema/modules/05-remuneration-and-working-hours.json' with { type: 'json' };

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const select = (label, choices) => `<div class="form-group"><label>${label}</label><div class="ui-select-container">
  <span class="ui-select-match"></span><input class="ui-select-search" type="search">
  <div class="choices" hidden>${choices.map((choice) => `<div class="ui-select-choices-row">${choice}</div>`).join('')}</div>
  </div></div>`;
const input = (id) => `<input id="${id}">`;
const detailRow = (index) => `<section class="detail-row">
  ${select('Interview type *', ['Individual', 'Group'])}
  ${input(`InterviewDetailsLanguage-${index}-0`)}
  ${select('The interviewer is:', ['Female', 'Male', 'Non-binary'])}
  ${input(`InterviewDetailsNoofInterviewees-${index}-0`)}
  ${select('Location of interview', ['On-site', 'Off-site'])}
  ${select('The interviewee(s) is/are:', ['Female', 'Male', 'Mixed'])}
  <textarea id="InterviewDetailsInterviewNotes-${index}-0"></textarea></section>`;

async function fixture(t, html) {
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  t.after(() => page.close());
  await page.setContent(`<style>[hidden]{display:none!important}.ui-select-choices-row{cursor:pointer;padding:2px}</style>${html}`);
  await page.evaluate(() => {
    document.addEventListener('click', (event) => {
      const container = event.target.closest('.ui-select-container');
      if (!container) return;
      const choices = container.querySelector('.choices');
      if (event.target.matches('.ui-select-choices-row')) {
        container.querySelector('.ui-select-match').textContent = event.target.textContent;
        choices.hidden = true;
      } else choices.hidden = false;
    });
  });
  return page;
}

test('one live category row does not shift interpreter or interview controls; row 2 is created after row 1 is filled', async (t) => {
  const page = await fixture(t, `<section><table><tr><td>${select('Worker category', ['Permanent'])}</td><td>${input('WorkerCategoriesInterviewedMale-0-1')}</td></tr></table><button id="wrong-add">+ Add Another</button></section>
    <section><h3>Interpreter Details</h3>${select('Were interpreters used during this activity? *', ['Yes', 'No'])}</section>
    <section id="details"><h3>Interview Details</h3>${detailRow(0)}<button id="add">+ Add Another</button></section>`);
  await page.evaluate((nextRow) => {
    document.querySelector('#wrong-add').onclick = () => { throw new Error('Wrong grid'); };
    document.querySelector('#add').onclick = () => {
      if (!document.querySelector('#details .ui-select-match').textContent || !document.querySelector('#InterviewDetailsLanguage-0-0').value) return;
      document.querySelector('#add').insertAdjacentHTML('beforebegin', nextRow);
    };
  }, detailRow(1));
  const module = materializeRepeatableReportModule(interviewSchema);
  const values = {
    '10-interview-evidence__search_20': 'No', '10-interview-evidence__search_22': 'Individual',
    'InterviewDetailsLanguage-0-0': 'English', '10-interview-evidence__search_25': 'Male',
    'InterviewDetailsInterviewNotes-0-0': 'First', '10-interview-evidence__search_33': 'Group',
    'InterviewDetailsLanguage-1-0': 'French', 'InterviewDetailsInterviewNotes-1-0': 'Second'
  };
  const fields = getReportFieldsToFill(values, module.fields).fieldsToFill;
  assert.equal(await fillReportModuleFields(page, module, fields, values, () => {}), 8);
  assert.equal(await page.locator('#details .detail-row').count(), 2);
  assert.equal(await page.locator('#details .ui-select-match').nth(1).innerText(), 'Male');
  await verifyReportModule(page, fields, values);
  await page.locator('#details .ui-select-match').first().evaluate((element) => { element.textContent = 'Group'; });
  await assert.rejects(verifyReportModule(page, fields, values), /保存后选项不一致/);
});

test('Source of data is found with fewer benefit rows and a hidden conditional field', async (t) => {
  const page = await fixture(t, `<section>${select('Type of benefit', ['Medical'])}${select('Frequency', ['Monthly'])}</section>
    <section><h3>Living Wage</h3>${input('CalculatedLivingWage')}
      ${select('Source of data', ['GLWC website', 'Manually collected by auditor'])}
      <div hidden>${input('LivingWagePleaseaddthelinkofGlwCSource')}</div>
      ${select('Local currency', ['CNY'])}</section>`);
  const module = materializeRepeatableReportModule(remunerationSchema);
  const field = module.fields.find((field) => field.key === '05-remuneration-and-working-hours__search_19');
  await fillReportField(page, field, 'Manually collected by auditor');
  await verifyReportModule(page, [field], { [field.key]: 'Manually collected by auditor' });
  assert.equal(await page.locator('.ui-select-match').nth(0).innerText(), '');
});

test('Living Wage currency uses its single visible dropdown when the other conditional dropdown is hidden', async (t) => {
  const page = await fixture(t, `<section><h3>Living Wage</h3>${input('CalculatedLivingWage')}
    <div hidden>${select('Source of data', ['GLWC website', 'Manually collected by auditor'])}</div>
    ${select('Local currency', ['CNY'])}</section>`);
  const module = materializeRepeatableReportModule(remunerationSchema);
  const field = module.fields.find((field) => field.key === '05-remuneration-and-working-hours__search_24');
  await fillReportField(page, field, 'CNY');
  await verifyReportModule(page, [field], { [field.key]: 'CNY' });
  assert.equal(await page.locator('.ui-select-match:visible').innerText(), 'CNY');
});

test('annual production volume unit uses the first dropdown after its input inside a larger module', async (t) => {
  const page = await fixture(t, `<section><h3>Production and Employment Structure</h3>
    ${input('ProdEmpStructureAnnualProdVol')}${select('Select box', ['Pieces', 'Tons'])}
    ${select('Department setting', ['Yes', 'No'])}${select('Other row', ['A', 'B'])}${select('Migrant row', ['C', 'D'])}</section>`);
  const module = materializeRepeatableReportModule(productionSchema);
  const field = module.fields.find((candidate) => candidate.key === '04-production-and-employment-structure__search_2');
  await fillReportField(page, field, 'Pieces');
  await verifyReportModule(page, [field], { [field.key]: 'Pieces' });
  assert.deepEqual(await page.locator('.ui-select-match').allTextContents(), ['Pieces', '', '', '']);
});

test('text fields target the visible control and persist blur changes; mismatch identifies the exact Title', async (t) => {
  const id = 'OverallSocPerformanceMngRSPProceduresTitle-0-0';
  const page = await fixture(t, `<div hidden>${input(id)}</div>${input(id)}`);
  await page.locator(`[id="${id}"]:visible`).evaluate((element) => {
    element.addEventListener('blur', () => { element.dataset.saved = element.value; });
  });
  const field = { key: id, label: 'Title', type: 'text', selector: `#${id}` };
  await fillReportField(page, field, 'Manager');
  assert.equal(await page.locator(`[id="${id}"]:visible`).getAttribute('data-saved'), 'Manager');
  await verifyReportModule(page, [field], { [id]: 'Manager' });
  await assert.rejects(verifyReportModule(page, [field], { [id]: 'Other' }), /RSPProceduresTitle-0-0.*Manager/);
});

test('ambiguous add buttons do not click an adjacent grid', async (t) => {
  const page = await fixture(t, `<main>${input('anchor')}<section><button>Add Another</button></section><section><button>Add Another</button></section></main>`);
  await assert.rejects(locateRepeatableAddButton(page, '#anchor', ['Add Another'], 'details', 1), /Add button was not found/);
});

test('repeatable rows use the matching Add Another after the row anchor', async (t) => {
  const page = await fixture(t, `<main><button id="previous">+ Add Another</button>${input('anchor')}<button id="target">+ Add Another</button></main>`);
  const button = await locateRepeatableAddButton(page, '#anchor', ['Add Another'], 'details', 1);
  assert.equal(await button.getAttribute('id'), 'target');
});

test('Interview Details may place its own Add Another before the row anchor', async (t) => {
  const page = await fixture(t, `<main><button id="previous">+ Add Another</button>
    <section><h3>Interview Details</h3><button id="target">+ Add Another</button>${input('anchor')}</section></main>`);
  const button = await locateRepeatableAddButton(page, '#anchor', ['Add Another'], 'interview-details', 1, 'Interview Details');
  assert.equal(await button.getAttribute('id'), 'target');
});

test('opens the Report tab when its section link is rendered lazily', async (t) => {
  const page = await fixture(t, '<button id="tab-monitoring.report">Report</button>');
  const target = 'data:text/html,%3Ca%20class%3D%22js-open-section%22%3EModule%3C%2Fa%3E#report-sections';
  await page.locator('[id="tab-monitoring.report"]').evaluate((button, href) => {
    button.onclick = () => button.insertAdjacentHTML('afterend', `<a href="${href}">Report section</a>`);
  }, target);
  assert.equal(await openReportIndex(page, () => {}), target);
});
