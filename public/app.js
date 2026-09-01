import {
  addRepeatableRow,
  getRepeatableGroupForTable,
  materializeRepeatableReportModule
} from './reportRepeatables.js';

const controllerForm = document.querySelector('#controllerForm');
const runButton = document.querySelector('#runButton');
const runReportButton = document.querySelector('#runReportButton');
const saveCredentialsButton = document.querySelector('#saveCredentialsButton');
const saveTemplateButton = document.querySelector('#saveTemplateButton');
const saveReportTemplateButton = document.querySelector('#saveReportTemplateButton');
const selectAllReportButton = document.querySelector('#selectAllReportButton');
const loadAttachmentsButton = document.querySelector('#loadAttachmentsButton');
const uploadAttachmentsButton = document.querySelector('#uploadAttachmentsButton');
const refreshLogsButton = document.querySelector('#refreshLogsButton');
const statusBox = document.querySelector('#status');
const resultBox = document.querySelector('#resultBox');
const logsBox = document.querySelector('#logs');
const attachmentPreview = document.querySelector('#attachmentPreview');
const reportSummary = document.querySelector('#reportSummary');
const reportModuleList = document.querySelector('#reportModuleList');
const reportEditorHeader = document.querySelector('#reportEditorHeader');
const reportFields = document.querySelector('#reportFields');
const reportRunDialog = document.querySelector('#reportRunDialog');
const closeReportRunDialogButton = document.querySelector('#closeReportRunDialogButton');
const reportRunDialogSummary = document.querySelector('#reportRunDialogSummary');
const reportRunDialogList = document.querySelector('#reportRunDialogList');

let attachmentPreviewState = null;
let reportIndex = null;
let reportTemplate = { version: 1, modules: {} };
let currentReportModuleId = '';
let currentReportModule = null;
let selectedReportModuleIds = new Set();
let reportDirty = false;
let reportModuleStates = new Map();
let reportExecutionRunning = false;

const REPORT_MODULE_STATUS = {
  pending: '待执行',
  running: '执行中',
  completed: '完成',
  skipped: '已跳过',
  failed: '错误',
  'not-run': '未执行'
};

const PA_ANSWER_OPTIONS = [
  { suffix: 'yes', label: 'Yes' },
  { suffix: 'partially', label: 'Partially' },
  { suffix: 'no', label: 'No' },
  { suffix: 'n/A', label: 'N/A' }
];
const PA_EVIDENCE_OPTIONS = [
  { suffix: 'mi', label: 'MI' },
  { suffix: 'wi', label: 'WI' },
  { suffix: 'wri', label: 'WRI' },
  { suffix: 'so', label: 'SO' },
  { suffix: 'de', label: 'DE' }
];
const PA_QUESTION_TEXT = {
  1: {
    1: 'Is there satisfactory evidence that the auditee has set up an effective management system to implement the amfori BSCI Code of Conduct?',
    2: 'Is there satisfactory evidence that a senior manager has been appointed to ensure that the values and principles of amfori BSCI are followed in a satisfactory manner?',
    3: 'Is there satisfactory evidence that the auditee has identified their significant business partners and their level of alignment with the amfori BSCI Code of Conduct?',
    4: "Is there satisfactory evidence that the auditee's workforce capacity is properly organised to meet the expectations of the delivery order and/or contracts?",
    5: 'Is there satisfactory evidence that the auditee monitors how its business partners observe the amfori BSCI Code of Conduct?',
    6: 'Is there satisfactory evidence that the auditee has developed the necessary policies and processes to prevent and address any adverse human rights impacts that may be detected in its supply chain?',
    7: 'Is there satisfactory evidence that the auditee manages its business relations in a responsible manner?',
  },
  2: {
    1: 'Is there satisfactory evidence that the auditee has good management practices that involve workers and their representatives in sound information exchange on workplace issues?',
    2: 'Is there satisfactory evidence that the auditee defines long-term goals for protecting workers in line with the aspirations of the amfori BSCI Code of Conduct?',
    3: 'CRUCIAL: Is there satisfactory evidence that the auditee takes specific steps to make workers aware of their rights and responsibilities?',
    4: 'Is there satisfactory evidence that the auditee builds sufficient competence among managers, workers and workers representatives to successfully embed responsible practices in the business operation?',
    5: 'Is there satisfactory evidence that the auditee has established, or participates in, an effective operational-level grievance mechanism for individuals and communities?',
  },
  3: {
    1: 'Is there satisfactory evidence that the auditee respects the right of workers to form unions - or to refrain from doing so- without distinction whatsoever and irrespective of gender in a free and democratic way?',
    2: "CRUCIAL: Is there satisfactory evidence that the auditee respects workers' right to bargain collectively without distinction whatsoever and irrespective of gender?",
    3: 'Is there satisfactory evidence that the auditee does not discriminate against workers because of their trade union membership?',
    4: "Is there satisfactory evidence that the auditee does not prevent workers' representatives from accessing or interacting with workers in the workplace?",
  },
  4: {
    1: 'CRUCIAL: Is there satisfactory evidence that the auditee takes the necessary measures to avoid or eradicate discrimination in the workplace?',
    2: 'Is there satisfactory evidence that the auditee takes the necessary preventative and/or remedial measures to ensure workers are not disciplined, dismissed, harassed or otherwise discriminated against because of their complaints against infringements of their rights?',
    3: 'Is there satisfactory evidence that the auditee takes the necessary preventative and/or remedial measures so workers are not harassed or disciplined on grounds of discrimination as listed in the amfori BSCI Code?',
  },
  5: {
    1: "CRUCIAL: Is there satisfactory evidence that the auditee complies with the government's minimum wage legislation or the industry standard approved through collective bargaining?",
    2: 'Is there satisfactory evidence that wages are paid in a timely, stable and regular manner, and fully in legal tender?',
    3: 'Is there satisfactory evidence that the level of wages reflects the skills, seniority, responsibility and education of workers?',
    4: 'Is there satisfactory evidence that the auditee provides sufficient remuneration that allows workers to meet a decent standard of living?',
    5: 'Is there satisfactory evidence that the auditee provides workers with the social benefits that are legally granted without negative impact on their pay, level of seniority, position, or promotion prospects?',
    6: 'CRUCIAL: Is there satisfactory evidence that the auditee ensures that deductions are only taken under the conditions and to the extent prescribed by the law?',
  },
  6: {
    1: 'Is there satisfactory evidence that the auditee does not require more than 48 standard working hours per week, without prejudice to the exceptions recognised by the ILO?',
    2: 'CRUCIAL: Is there satisfactory evidence that the auditee request of overtime is in line with the requirements of the amfori BSCI Code of Conduct?',
    3: 'CRUCIAL: Is there satisfactory evidence that the auditee grants workers the right to resting breaks in every working day?',
    4: 'CRUCIAL: Is there satisfactory evidence that the auditee grants workers the right to at least one day off in every seven days?',
  },
  7: {
    1: 'Is there satisfactory evidence that the auditee observes occupational health and safety regulations applicable for its activities?',
    2: "Is there satisfactory evidence that the auditee seeks to improve workers' protection in case of accident, including through compulsory insurance schemes?",
    3: 'Is there satisfactory evidence that the auditee set up an effective management system that ensures they regularly carry out risk assessments for safe, healthy and hygienic working conditions?',
    4: 'Is there satisfactory evidence of active cooperation between management and workers (and/or their representatives) when developing and implementing systems towards ensuring OHS?',
    5: 'Is there satisfactory evidence that the auditee regularly provides OHS trainings to ensure workers understand the rules of work, personal protection and measures for preventing and reacting to injury to themselves and fellow workers?',
    6: 'Is there satisfactory evidence that the auditee enforces the use of PPE to provide protection to workers alongside other controls and safety systems?',
    7: 'Is there satisfactory evidence that the auditee implements engineering and administrative control measures to avoid or minimise the release of hazardous substances into the work environment, keeping the level of exposure below internationally established or recognised limits?',
    8: 'Is there satisfactory evidence that the auditee has developed and implemented accident and emergency procedures?',
    9: 'Is there satisfactory evidence that the auditee makes visible potential hazards to the workers and visitors through signs and warnings?',
    10: 'Is there satisfactory evidence that the auditee has and properly uses procedures and systems for reporting and recording occupational accidents and injuries?',
    11: 'Is there satisfactory evidence that the auditee confirms that the equipment and buildings used for production are stable and safe?',
    12: "CRUCIAL: Is there satisfactory evidence that the auditee respects the workers' right to remove themselves from imminent danger without seeking permission?",
    13: 'Is there satisfactory evidence that the auditee makes sure a competent person periodically checks the electrical installations and equipment?',
    14: 'CRUCIAL: Is there satisfactory evidence that the auditee has installed an adequate amount of properly working firefighting equipment?',
    15: 'CRUCIAL: Is there satisfactory evidence that the auditee ensures that escape routes, aisles and emergency exits in the production site are not blocked, easily accessible and clearly marked?',
    16: 'Is there satisfactory evidence that the auditee ensures evacuations plans meet legal requirements and that these plans are posted in relevant places so workers can see and understand them?',
    17: 'Is there satisfactory evidence that the auditee ensures adequate safeguards for any machine part, function, or process which may cause injury to workers?',
    18: 'CRUCIAL: Is there satisfactory evidence that the auditee ensures qualified first-aid is available at all times?',
    19: 'Is there satisfactory evidence that the auditee has emergency procedures, in writing, to deal with cases of trauma or serious illness?',
    20: 'CRUCIAL: Is there satisfactory evidence that the auditee always provides workers with access to potable water?',
    21: 'Is there satisfactory evidence that the auditee provides workers with access to an appropriate, clean area for storing food, eating and/or cooking?',
    22: 'Is there satisfactory evidence that the auditee provides workers with clean washing facilities, changing rooms and toilets that are also respectful of local customs?',
    23: 'Is there satisfactory evidence that the auditee provision of transportation to workers is safe and complies with national regulations?',
    24: 'Is there satisfactory evidence that the auditee has chosen the location of the social facilities or workers housing to ensure occupants are not exposed to natural hazards or affected by the operational impacts of the worksite (for example noise, emissions or dust)?',
    25: 'Is there satisfactory evidence the auditee verifies that temperature, humidity, space, sanitation, illumination are adequate for the health and safety of workers?',
  },
  8: {
    1: 'CRUCIAL: Is there satisfactory evidence that the auditee does not engage in illegal child labour directly or indirectly?',
    2: 'Is there satisfactory evidence that the auditee has established robust age-verification mechanisms as part of the recruitment process, which may not be in any way degrading or disrespectful to the worker?',
    3: 'Is there satisfactory evidence that the auditee has adequate policies and procedures in writing toward protecting children from any kind of exploitation?',
    4: 'Is there satisfactory evidence that the auditee has adequate and remedial policies and procedures to provide for further protection in case children are found to be working?',
  },
  9: {
    1: 'Is there satisfactory evidence that the auditee ensures that young persons do not work at night and are protected against conditions of work which are prejudicial to their health, safety, morals and development?',
    2: "CRUCIAL: Is there satisfactory evidence that young workers' working hours do not prejudice their attendance at school, their participation in vocational orientation approved by the competent authority or their capacity to benefit from training or instruction programmes?",
    4: 'Is there satisfactory evidence that the auditee seeks to ensure young workers have access to effective grievance mechanisms?',
    5: 'Is there satisfactory evidence that the auditee seeks to ensure that young workers are properly trained on OHS and have access to related training programmes?',
    6: 'Is there satisfactory evidence that the auditee has a good overview of all young workers engaged in its production site?',
  },
  10: {
    1: 'Is there satisfactory evidence that auditee employment relationships are not precarious for the workers?',
    2: 'Is there satisfactory evidence that the auditee engages workers based on recognised and documented employment relationships?',
    3: 'Is there satisfactory evidence that the auditee provides workers with understandable information before entering into employment?',
    4: 'CRUCIAL: Is there satisfactory evidence that the auditee does not use employment arrangements in a way that deliberately conflicts with the genuine purpose of the law?',
  },
  11: {
    1: 'CRUCIAL: Is there satisfactory evidence that the auditee does not engage in, or through business partners, complicit to in any form of servitude, forced, state-imposed forced labour, bonded, indentured, trafficked or non-voluntary labour?',
    2: 'Is there satisfactory evidence that the auditee acts rigorously and diligently when engaging and recruiting migrant workers both directly and indirectly?',
    3: 'CRUCIAL: Is there satisfactory evidence that the auditee does not subject workers to inhumane or degrading treatment, corporal punishment, mental, physical coercion, verbal and/or sexual abuse?',
    4: 'Is there satisfactory evidence that the auditee has established all applicable disciplinary procedures in writing and has explained them verbally to workers in clear and understandable terms?',
  },
  12: {
    1: 'Is there satisfactory evidence that the auditee continuously identifies the significant impacts and environmental implications associated to its activity?',
    2: 'Is there satisfactory evidence that the auditee has procedures in place to ensure integration of local environmental law into the business model?',
    3: "Is there satisfactory evidence of the auditee's required environmental permits and licences?",
    4: 'Is there satisfactory evidence that waste is managed in a way that does not lead to the pollution of the environment?',
    5: 'Is there satisfactory evidence that water is managed in a way that respects the environment, particularly but not limited to preserving local water sources?',
  },
  13: {
    1: 'Is there satisfactory evidence that the auditee actively opposes any act of corruption, extortion or embezzlement, or any form of bribery in its activities as a business enterprise?',
    2: 'Is there satisfactory evidence that the auditee keeps accurate information regarding its own activities, structure and performance?',
    3: 'CRUCIAL: Is there satisfactory evidence that the auditee takes the necessary measures to not take part in falsifying Information related to its activities, structure and performance; nor in any act of misrepresentation of its supply chain?',
    4: 'Is there satisfactory evidence that the auditee collects uses and otherwise processes personal information with reasonable care and in accordance with privacy and information security laws and regulatory requirements?',
  },
};

await Promise.all([loadTemplate(), loadReportWorkspace(), loadLogs()]);

controllerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runTextTask();
});
saveTemplateButton.addEventListener('click', saveTemplate);
saveCredentialsButton.addEventListener('click', saveCredentials);
saveReportTemplateButton.addEventListener('click', saveReportTemplate);
selectAllReportButton.addEventListener('click', toggleAllReportModules);
runReportButton.addEventListener('click', runReportTask);
closeReportRunDialogButton.addEventListener('click', () => reportRunDialog.close());
loadAttachmentsButton.addEventListener('click', loadAttachments);
uploadAttachmentsButton.addEventListener('click', uploadAttachmentsOnly);
refreshLogsButton.addEventListener('click', loadLogs);
document.querySelector('#attachmentFolder').addEventListener('input', clearAttachmentPreview);
document.querySelector('#monitoringId').addEventListener('input', clearAttachmentPreview);

async function loadTemplate() {
  const payload = await requestJson('/api/template');
  if (!payload.ok) return setStatus('failed', payload.error || '模板读取失败');
  const template = payload.template;
  setValue('username', template.credentials?.username);
  setValue('password', template.credentials?.password);
  setValue('monitoringId', template.monitoringId);
  setValue('attachmentFolder', template.attachmentFolder);
  setValue('generalDescription', template.fields?.generalDescription);
  setValue('confidentialComments', template.fields?.confidentialComments);
}

async function loadReportWorkspace() {
  const [indexPayload, templatePayload] = await Promise.all([
    requestJson('/api/report/index'), requestJson('/api/report/template')
  ]);
  if (!indexPayload.ok || !templatePayload.ok) {
    reportSummary.textContent = 'Report schema 读取失败。';
    return;
  }
  reportIndex = indexPayload.index;
  reportTemplate = templatePayload.template || { version: 1, modules: {} };
  reportSummary.textContent = `共 ${reportIndex.modules.length} 个模块，${reportIndex.modules.reduce((total, item) => total + item.fieldCount, 0)} 个可编辑字段。选择模块后加载。`;
  renderReportModuleList();
}

async function openReportModule(moduleId) {
  if (reportDirty && !window.confirm('当前 Report 模块有未保存修改，仍要切换吗？')) return;
  currentReportModuleId = moduleId;
  renderReportModuleList();
  reportFields.textContent = '正在加载模块...';
  const payload = await requestJson(`/api/report/modules/${encodeURIComponent(moduleId)}`);
  if (!payload.ok) {
    reportFields.textContent = payload.error || '模块读取失败。';
    return;
  }
  reportDirty = false;
  currentReportModule = payload.module;
  renderReportModule(payload.module);
}

function renderReportModuleList() {
  if (!reportIndex) return;
  reportModuleList.replaceChildren(...reportIndex.modules.map((module) => {
    const moduleState = reportModuleStates.get(module.id);
    const item = document.createElement('label');
    item.className = `report-module-item${module.id === currentReportModuleId ? ' active' : ''}${moduleState ? ` module-${moduleState.status}` : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedReportModuleIds.has(module.id);
    checkbox.disabled = reportExecutionRunning;
    checkbox.addEventListener('change', () => {
      checkbox.checked ? selectedReportModuleIds.add(module.id) : selectedReportModuleIds.delete(module.id);
      updateReportSelectionButton();
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = reportExecutionRunning;
    button.textContent = `${module.title} (${module.fieldCount})`;
    button.addEventListener('click', () => openReportModule(module.id));
    item.append(checkbox, button);
    if (moduleState) {
      const status = document.createElement('span');
      status.className = `module-status ${moduleState.status}`;
      status.textContent = REPORT_MODULE_STATUS[moduleState.status] || moduleState.status;
      status.title = moduleState.reason || status.textContent;
      item.append(status);
    }
    return item;
  }));
  updateReportSelectionButton();
}

function updateReportSelectionButton() {
  if (!reportIndex) return;
  const allSelected = selectedReportModuleIds.size === reportIndex.modules.length;
  selectAllReportButton.textContent = allSelected ? '取消选择全部模块' : '选择全部模块';
  runReportButton.textContent = selectedReportModuleIds.size > 0
    ? `执行已选 Report 模块 (${selectedReportModuleIds.size})`
    : '执行已选 Report 模块';
}

function toggleAllReportModules() {
  if (!reportIndex) return;
  if (selectedReportModuleIds.size === reportIndex.modules.length) selectedReportModuleIds.clear();
  else selectedReportModuleIds = new Set(reportIndex.modules.map((module) => module.id));
  renderReportModuleList();
}

function renderReportModule(module) {
  currentReportModule = module;
  module = materializeRepeatableReportModule(module, reportTemplate.modules?.[module.id] || {});
  reportEditorHeader.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = module.title;
  const count = document.createElement('p');
  count.className = 'hint';
  count.textContent = `${module.fields.length} 个字段；留空内容在执行时会跳过。`;
  reportEditorHeader.append(title, count);
  reportFields.replaceChildren();

  const fieldById = new Map(module.fields.map((field) => [field.key, field]));
  const coveredKeys = new Set();
  const performanceArea = getPerformanceAreaModel(module, fieldById);

  if (performanceArea) {
    renderPerformanceAreaModule(module, fieldById, coveredKeys, performanceArea);
    return;
  }

  if (Array.isArray(module.layout) && module.layout.length > 0) {
    // 按采集的布局树渲染（章节/分组/字段/选项组/表格）
    for (const block of module.layout) {
      const rendered = renderLayoutBlock(block, fieldById, module, coveredKeys);
      if (rendered) reportFields.append(rendered);
    }
  } else {
    // 无布局时的兜底：表格 + 扁平字段
    for (const table of module.tables || []) {
      const rows = (table.sampleRows || []).map((row) => row.map((cell) => (cell && cell.id && fieldById.has(cell.id) ? cell.id : null)));
      for (const row of rows) for (const key of row) if (key) coveredKeys.add(key);
      const rendered = renderReportTable({ ...table, rows }, fieldById, module.id);
      if (rendered) reportFields.append(rendered);
    }
  }

  // 追加未被布局覆盖的字段（防漏）
  for (const field of module.fields) {
    if (!coveredKeys.has(field.key)) reportFields.append(renderReportField(field, module.id));
  }
}

function getPerformanceAreaModel(module, fieldById) {
  const paFromTitle = module.title.match(/^PA\s*(\d+)/i);
  if (!paFromTitle) return null;
  const paNumber = Number(paFromTitle[1]);
  const prefix = `MAN_PA${paNumber}_`;
  const answerPattern = new RegExp(`^${prefix}(\\d+)-(yes|partially|no|n/A)$`, 'i');
  const findingPattern = new RegExp(`^${prefix}(\\d+)Finding(EN|LOCAL)$`, 'i');
  const evidencePattern = new RegExp(`^${prefix}(\\d+)Evidence(\\d*)-(mi|wi|wri|so|de)$`, 'i');

  const questions = new Map();
  let currentQuestionNumber = null;

  const ensureQuestion = (number) => {
    let question = questions.get(number);
    if (!question) {
      question = {
        number,
        label: getPerformanceAreaQuestionLabel(paNumber, number, module.title),
        answers: new Map(),
        evidence: new Map(),
        findingEN: null,
        findingLOCAL: null
      };
      questions.set(number, question);
    }
    return question;
  };

  for (const field of fieldById.values()) {
    const answerMatch = field.key.match(answerPattern);
    if (answerMatch) {
      currentQuestionNumber = Number(answerMatch[1]);
      ensureQuestion(currentQuestionNumber).answers.set(normalizePaSuffix(answerMatch[2]), field);
      continue;
    }

    const findingMatch = field.key.match(findingPattern);
    if (findingMatch) {
      currentQuestionNumber = Number(findingMatch[1]);
      const question = ensureQuestion(currentQuestionNumber);
      if (findingMatch[2].toUpperCase() === 'EN') question.findingEN = field;
      else question.findingLOCAL = field;
      continue;
    }

    const evidenceMatch = field.key.match(evidencePattern);
    if (evidenceMatch) {
      // 证据字段的编号可能异常（如 “12Evidence2” 实际属于下一题 13）。
      // 按字段顺序归属到其答案/发现字段紧邻的题目，避免证据被当作孤儿字段漏排到模块底部。
      const question = ensureQuestion(currentQuestionNumber ?? Number(evidenceMatch[1]));
      question.evidence.set(normalizePaSuffix(evidenceMatch[3]), field);
      continue;
    }
  }

  if (questions.size === 0) return null;
  return {
    paNumber,
    title: module.title.replace(/^PA\s*/, 'Performance Area '),
    questions: [...questions.values()].sort((left, right) => left.number - right.number)
  };
}

function renderPerformanceAreaModule(module, fieldById, coveredKeys, performanceArea) {
  for (const block of module.layout || []) {
    if (isPerformanceAreaQuestionGroup(block, performanceArea.paNumber)) continue;
    const rendered = renderLayoutBlock(block, fieldById, module, coveredKeys);
    if (rendered) reportFields.append(rendered);
  }

  const section = document.createElement('section');
  section.className = 'pa-module';
  const header = document.createElement('div');
  header.className = 'pa-module-header';
  header.textContent = performanceArea.title;
  section.append(header);

  const body = document.createElement('div');
  body.className = 'pa-module-body';
  for (const question of performanceArea.questions) {
    body.append(renderPerformanceAreaQuestion(question, module.id, performanceArea.paNumber));
    for (const field of [
      ...question.answers.values(),
      ...question.evidence.values(),
      question.findingEN,
      question.findingLOCAL
    ]) {
      if (field) coveredKeys.add(field.key);
    }
  }
  section.append(body);
  reportFields.append(section);

  for (const field of module.fields) {
    if (!coveredKeys.has(field.key)) reportFields.append(renderReportField(field, module.id));
  }
}

function renderPerformanceAreaQuestion(question, moduleId, paNumber) {
  const article = document.createElement('article');
  article.className = 'pa-question';

  const main = document.createElement('div');
  main.className = 'pa-question-main';
  const title = document.createElement('h4');
  title.className = 'pa-question-title';
  title.textContent = `${paNumber}.${question.number} ${question.label}`;
  main.append(title, renderPaAnswers(question, moduleId), renderPaFindingToggle(question, moduleId));

  const evidence = document.createElement('aside');
  evidence.className = 'pa-evidence';
  const evidenceTitle = document.createElement('strong');
  evidenceTitle.textContent = 'Evidence';
  evidence.append(evidenceTitle);
  for (const option of PA_EVIDENCE_OPTIONS) {
    const field = question.evidence.get(option.suffix);
    if (field) evidence.append(renderPaCheckbox(field, moduleId, option.label));
  }

  article.append(main, evidence);
  return article;
}

function renderPaAnswers(question, moduleId) {
  const group = document.createElement('div');
  group.className = 'pa-answer-group';
  for (const option of PA_ANSWER_OPTIONS) {
    const field = question.answers.get(option.suffix);
    if (!field) continue;
    const label = document.createElement('label');
    label.className = 'pa-answer';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `${moduleId}-${field.name || `pa-question-${question.number}`}`;
    input.checked = Boolean(reportTemplate.modules?.[moduleId]?.[field.key]);
    input.dataset.reportModule = moduleId;
    input.dataset.reportKey = field.key;
    input.dataset.reportRadioGroup = [...question.answers.values()].map((item) => item.key).join('|');
    input.addEventListener('change', persistPaAnswerInput);
    label.append(input, document.createTextNode(option.label));
    group.append(label);
  }
  return group;
}

function renderPaFindingToggle(question, moduleId) {
  const wrapper = document.createElement('details');
  wrapper.className = 'pa-finding';
  const summary = document.createElement('summary');
  summary.textContent = 'Finding / Advance';
  wrapper.append(summary);

  const grid = document.createElement('div');
  grid.className = 'pa-finding-grid';
  if (question.findingEN) grid.append(renderReportField(question.findingEN, moduleId, 'Finding (English)'));
  if (question.findingLOCAL) grid.append(renderReportField(question.findingLOCAL, moduleId, 'Finding (local language)'));
  wrapper.append(grid);
  return wrapper;
}

function renderPaCheckbox(field, moduleId, labelText) {
  const label = document.createElement('label');
  label.className = 'pa-evidence-option';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(reportTemplate.modules?.[moduleId]?.[field.key]);
  input.dataset.reportModule = moduleId;
  input.dataset.reportKey = field.key;
  input.addEventListener('change', persistReportInput);
  label.append(input, document.createTextNode(labelText));
  return label;
}

function isPerformanceAreaQuestionGroup(block, paNumber) {
  return block.type === 'group' && new RegExp(`Performance Area\\s*${paNumber}\\b`, 'i').test(block.title || '');
}

function getPerformanceAreaQuestionLabel(paNumber, questionNumber, moduleTitle) {
  return PA_QUESTION_TEXT[paNumber]?.[questionNumber] || `${moduleTitle.replace(/^PA\s*\d+\s*:\s*/i, '')} question ${questionNumber}`;
}

function normalizePaSuffix(value) {
  return String(value).toLowerCase() === 'n/a' ? 'n/A' : String(value).toLowerCase();
}

function renderLayoutBlock(block, fieldById, module, coveredKeys) {
  switch (block.type) {
    case 'group': {
      const section = document.createElement('section');
      section.className = 'report-group';
      const heading = document.createElement('h4');
      heading.className = 'report-group-title';
      heading.textContent = block.title || '';
      section.append(heading);
      const body = document.createElement('div');
      body.className = 'report-group-body';
      for (const child of block.children || []) {
        const rendered = renderLayoutBlock(child, fieldById, module, coveredKeys);
        if (rendered) body.append(rendered);
      }
      section.append(body);
      return section;
    }
    case 'help': {
      const p = document.createElement('p');
      p.className = 'report-help';
      p.textContent = block.text || '';
      return p;
    }
    case 'field': {
      const field = fieldById.get(block.key);
      if (!field) return null;
      coveredKeys.add(field.key);
      return renderReportField(field, module.id);
    }
    case 'field-group': {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'report-option-group';
      const legend = document.createElement('legend');
      legend.textContent = block.label || '';
      fieldset.append(legend);
      for (const key of block.optionKeys || []) {
        const field = fieldById.get(key);
        if (!field) continue;
        coveredKeys.add(field.key);
        fieldset.append(renderReportField(field, module.id));
      }
      return fieldset;
    }
    case 'table': {
      if (!Array.isArray(block.rows) || block.rows.length === 0) return null;
      for (const row of block.rows) for (const key of row) if (key != null && fieldById.has(key)) coveredKeys.add(key);
      const table = renderReportTable(block, fieldById, module.id);
      const repeatableGroup = getRepeatableGroupForTable(module.id, block);
      if (!table || !repeatableGroup) return table;
      const wrapper = document.createElement('div');
      wrapper.className = 'report-repeatable';
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'secondary compact';
      addButton.textContent = `添加${repeatableGroup.label}`;
      addButton.addEventListener('click', () => {
        reportTemplate.modules ??= {};
        reportTemplate.modules[module.id] = addRepeatableRow(
          reportTemplate.modules[module.id] || {},
          repeatableGroup,
          module
        );
        reportDirty = true;
        renderReportModule(currentReportModule);
      });
      wrapper.append(table, addButton);
      return wrapper;
    }
    default:
      return null;
  }
}

function renderReportTable(table, fieldById, moduleId) {
  // table.rows 为已解析的字段 key 数组（每单元格一个 key；无法定位的为 null）。
  const rows = (table.rows || []).map((row) => (row || []).map((key) => (key != null && fieldById.has(key) ? key : null)));
  if (rows.length === 0 || !rows.some((row) => row.some((key) => key != null))) return null;
  const colCount = Math.max((table.headers || []).length, ...rows.map((row) => row.length), 0);
  const wrapper = document.createElement('div');
  wrapper.className = 'report-table-wrap';
  const element = document.createElement('table');
  element.className = 'report-table';
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (let i = 0; i < colCount; i++) {
    const th = document.createElement('th'); th.textContent = (table.headers || [])[i] || ''; headerRow.append(th);
  }
  head.append(headerRow); element.append(head);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement('td');
      const key = row[i];
      if (key != null) td.append(renderReportField(fieldById.get(key), moduleId));
      tr.append(td);
    }
    body.append(tr);
  }
  element.append(body); wrapper.append(element); return wrapper;
}

function renderReportField(field, moduleId, overrideLabel = '') {
  const wrapper = document.createElement('label');
  wrapper.className = 'report-field';
  const label = document.createElement('span');
  label.textContent = overrideLabel || field.label || field.key;
  wrapper.append(label);
  const value = reportTemplate.modules?.[moduleId]?.[field.key];
  let input;
  if (field.type === 'textarea') {
    input = document.createElement('textarea'); input.rows = 4; input.value = value ?? '';
  } else if (field.type === 'select' || (field.type === 'ui-select' && Array.isArray(field.options) && field.options.length > 0)) {
    input = document.createElement('select');
    for (const option of field.options || []) {
      const optionElement = document.createElement('option');
      optionElement.value = option.value; optionElement.textContent = option.label || option.value;
      input.append(optionElement);
    }
    input.value = value ?? '';
  } else if (field.type === 'radio' || field.type === 'checkbox') {
    wrapper.classList.add('report-choice');
    input = document.createElement('input'); input.type = field.type; input.checked = Boolean(value);
    wrapper.replaceChildren(input, label);
  } else {
    input = document.createElement('input');
    input.type = field.type === 'number' || field.type === 'time' ? field.type : 'text';
    input.value = value ?? '';
    if (field.type === 'ui-select') input.placeholder = field.optionsStatus === 'partial' ? '输入关键词搜索（远程选项）' : '输入下拉选项文本';
  }
  input.dataset.reportModule = moduleId;
  input.dataset.reportKey = field.key;
  input.addEventListener('input', persistReportInput);
  input.addEventListener('change', persistReportInput);
  if (!wrapper.contains(input)) wrapper.append(input);
  return wrapper;
}

function persistReportInput(event) {
  const input = event.currentTarget;
  const moduleId = input.dataset.reportModule;
  const key = input.dataset.reportKey;
  reportTemplate.modules ??= {};
  reportTemplate.modules[moduleId] ??= {};
  reportTemplate.modules[moduleId][key] = input.type === 'checkbox' || input.type === 'radio' ? input.checked : input.value;
  reportDirty = true;
}

function persistPaAnswerInput(event) {
  const input = event.currentTarget;
  const moduleId = input.dataset.reportModule;
  const groupKeys = String(input.dataset.reportRadioGroup || '').split('|').filter(Boolean);
  reportTemplate.modules ??= {};
  reportTemplate.modules[moduleId] ??= {};
  for (const key of groupKeys) {
    reportTemplate.modules[moduleId][key] = key === input.dataset.reportKey;
  }
  reportDirty = true;
}

async function saveReportTemplate() {
  const payload = await requestJson('/api/report/template', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: reportTemplate })
  });
  if (payload.ok) { reportDirty = false; setStatus('success', 'Report 模板已保存到本机'); }
  else setStatus('failed', payload.error || 'Report 模板保存失败');
}

async function runReportTask() {
  const monitoringId = getValue('monitoringId');
  const moduleIds = [...selectedReportModuleIds];
  if (!monitoringId) return setStatus('failed', '请输入 Monitoring ID 后再执行 Report');
  if (moduleIds.length === 0) return setStatus('failed', '请先选择至少一个 Report 模块');
  const names = reportIndex.modules.filter((item) => moduleIds.includes(item.id)).map((item) => item.title);
  if (!window.confirm(`将向 ${monitoringId} 写入 ${names.length} 个 Report 模块。每个模块保存后会刷新校验；单个模块失败会记录并继续后续模块。\n\n${names.join('\n')}\n\n确认继续吗？`)) return;

  const runId = createReportRunId();
  reportExecutionRunning = true;
  applyReportModuleStates(moduleIds.map((id) => ({ id, status: 'pending', reason: '' })));
  setRunning(true); setStatus('running', `正在执行 ${moduleIds.length} 个 Report 模块，浏览器会自动打开。`); resultBox.textContent = '';
  const progressTimer = window.setInterval(() => refreshReportRunProgress(runId), 1200);
  try {
    const payload = await requestJson('/api/report/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, monitoringId, moduleIds, template: reportTemplate })
    });
    const result = payload.result || payload.progress || { status: 'failed', reason: payload.error || 'Report 执行失败', moduleResults: [] };
    applyReportModuleStates(result.moduleResults || []);
    const summary = summarizeReportRun(result.moduleResults || []);
    const statusType = result.status === 'success' ? 'success' : result.status === 'partial' ? 'partial' : 'failed';
    const message = result.status === 'success'
      ? `Report 执行完成：${summary.completed} 个模块已完成。`
      : result.status === 'partial'
        ? `Report 执行完成：${summary.completed} 个完成，${summary.failed} 个需人工处理。`
        : (result.reason || 'Report 执行失败，请查看模块汇总。');
    setStatus(statusType, message);
    resultBox.textContent = formatReportRunSummary(summary, result.reason);
    showReportRunDialog(result, moduleIds);
    await loadLogs();
  } catch (error) {
    setStatus('failed', error.message);
    resultBox.textContent = error.message;
    showReportRunDialog({ status: 'failed', reason: error.message, moduleResults: [...reportModuleStates.values()] }, moduleIds);
  } finally {
    window.clearInterval(progressTimer);
    await refreshReportRunProgress(runId);
    reportExecutionRunning = false;
    renderReportModuleList();
    setRunning(false);
  }
}

function createReportRunId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function refreshReportRunProgress(runId) {
  const payload = await requestJson(`/api/report/run-progress?runId=${encodeURIComponent(runId)}`);
  if (payload.ok && payload.progress?.moduleResults) applyReportModuleStates(payload.progress.moduleResults);
}

function applyReportModuleStates(moduleResults) {
  if (!Array.isArray(moduleResults) || moduleResults.length === 0) return;
  reportModuleStates = new Map(moduleResults.map((result) => [result.id, result]));
  renderReportModuleList();
}

function summarizeReportRun(moduleResults) {
  const results = Array.isArray(moduleResults) ? moduleResults : [];
  return {
    completed: results.filter((result) => result.status === 'completed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    notRun: results.filter((result) => result.status === 'not-run').length,
    running: results.filter((result) => result.status === 'running' || result.status === 'pending').length
  };
}

function formatReportRunSummary(summary, reason = '') {
  const lines = [`完成：${summary.completed}`, `错误：${summary.failed}`, `已跳过：${summary.skipped}`];
  if (summary.notRun) lines.push(`未执行：${summary.notRun}`);
  if (summary.running) lines.push(`执行中：${summary.running}`);
  if (reason) lines.push(`原因：${reason}`);
  return lines.join('\n');
}

function showReportRunDialog(result, moduleIds) {
  const resultsById = new Map((result.moduleResults || []).map((module) => [module.id, module]));
  const results = moduleIds.map((id) => resultsById.get(id) || {
    id,
    title: reportIndex.modules.find((module) => module.id === id)?.title || id,
    status: 'not-run',
    reason: result.reason || '未收到该模块的执行结果。'
  });
  const summary = summarizeReportRun(results);
  reportRunDialogSummary.textContent = result.status === 'success'
    ? `全部执行完成：${summary.completed} 个模块已通过保存校验。`
    : `执行结束：${summary.completed} 个完成，${summary.failed} 个错误，${summary.skipped} 个跳过，${summary.notRun} 个未执行。`;
  reportRunDialogList.replaceChildren(...results.map((module) => {
    const item = document.createElement('article');
    item.className = `report-run-result ${module.status}`;
    const title = document.createElement('strong');
    title.textContent = module.title;
    const status = document.createElement('span');
    status.className = `module-status ${module.status}`;
    status.textContent = REPORT_MODULE_STATUS[module.status] || module.status;
    item.append(title, status);
    if (module.status === 'completed') {
      const detail = document.createElement('small');
      detail.textContent = `已保存并刷新校验，共 ${module.filledFields || 0} 个字段。`;
      item.append(detail);
    }
    if (module.reason) {
      const detail = document.createElement('p');
      detail.className = 'report-run-error';
      detail.textContent = module.reason;
      item.append(detail);
    }
    return item;
  }));
  if (typeof reportRunDialog.showModal === 'function') reportRunDialog.showModal();
}

async function saveTemplate() {
  const payload = await requestJson('/api/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readFormTemplate()) });
  setStatus(payload.ok ? 'success' : 'failed', payload.ok ? '模板已保存' : (payload.error || '模板保存失败'));
}

async function saveCredentials() {
  const credentials = { username: getValue('username'), password: getValue('password') };
  if (!credentials.username || !credentials.password) return setStatus('failed', '请输入 amfori 账号和密码后再保存');
  const payload = await requestJson('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credentials }) });
  setStatus(payload.ok ? 'success' : 'failed', payload.ok ? '登录信息已写入本地文件' : (payload.error || '登录信息保存失败'));
}

async function runTextTask() {
  if (!getValue('monitoringId')) return setStatus('failed', '请输入 Monitoring ID 后再执行');
  const template = readFormTemplate();
  const labels = getOverwriteFieldLabels(template);
  if (!window.confirm(`本次只填写 General Description。${labels.length ? `\n将覆盖：${labels.join('、')}` : '\n全部字段为空，将跳过填写。'}\n附件和 Report 不会被操作。\n确认继续吗？`)) return;
  setRunning(true); setStatus('running', '正在执行，浏览器会自动打开。'); resultBox.textContent = '';
  try {
    const payload = await requestJson('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template) });
    setStatus(payload.ok ? 'success' : 'failed', payload.ok ? '执行成功，已确认保存' : (payload.error || payload.result?.reason || '执行失败'));
    resultBox.textContent = JSON.stringify(payload.result || payload, null, 2); await loadLogs();
  } catch (error) { setStatus('failed', error.message); } finally { setRunning(false); }
}

async function loadAttachments() {
  const attachmentFolder = getValue('attachmentFolder');
  if (!attachmentFolder) return setStatus('failed', '请先填写附件文件夹路径');
  loadAttachmentsButton.disabled = true; attachmentPreview.textContent = '正在读取文件夹...';
  try {
    const payload = await requestJson('/api/attachments/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attachmentFolder }) });
    if (!payload.ok) throw new Error(payload.error || '附件读取失败');
    attachmentPreviewState = { attachmentFolder, monitoringId: getValue('monitoringId'), files: payload.files };
    renderAttachmentPreview(payload.files); uploadAttachmentsButton.disabled = payload.files.length === 0;
    setStatus('success', `已检测到 ${payload.files.length} 个附件文件`);
  } catch (error) { attachmentPreview.textContent = error.message; setStatus('failed', error.message); } finally { loadAttachmentsButton.disabled = false; }
}

async function uploadAttachmentsOnly() {
  const monitoringId = getValue('monitoringId'); const attachmentFolder = getValue('attachmentFolder');
  if (!monitoringId) return setStatus('failed', '请输入 Monitoring ID 后再上传附件');
  if (!attachmentPreviewState || attachmentPreviewState.attachmentFolder !== attachmentFolder || attachmentPreviewState.monitoringId !== monitoringId) return setStatus('failed', '附件路径或 Monitoring ID 已变化，请重新加载附件文件');
  if (!window.confirm(`仅向 ${monitoringId} 上传 ${attachmentPreviewState.files.length} 个附件，不会填写任何文本表单。确认吗？`)) return;
  setRunning(true); setStatus('running', '正在上传附件。'); resultBox.textContent = '';
  try {
    const payload = await requestJson('/api/attachments/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monitoringId, attachmentFolder, fileNames: attachmentPreviewState.files }) });
    setStatus(payload.ok ? 'success' : 'failed', payload.ok ? '附件上传成功，已确认保存' : (payload.error || payload.result?.reason || '附件上传失败'));
    resultBox.textContent = JSON.stringify(payload.result || payload, null, 2); await loadLogs();
  } catch (error) { setStatus('failed', error.message); } finally { setRunning(false); }
}

function readFormTemplate() { return { monitoringId: getValue('monitoringId'), attachmentFolder: getValue('attachmentFolder'), credentials: { username: getValue('username'), password: getValue('password') }, fields: { generalDescription: getValue('generalDescription'), confidentialComments: getValue('confidentialComments') } }; }
function clearAttachmentPreview() { attachmentPreviewState = null; uploadAttachmentsButton.disabled = true; attachmentPreview.textContent = '填写文件夹路径后，可先加载文件名进行确认。'; }
function renderAttachmentPreview(files) { attachmentPreview.replaceChildren(); const strong = document.createElement('strong'); strong.textContent = `检测到 ${files.length} 个文件`; attachmentPreview.append(strong); const list = document.createElement('ul'); for (const file of files) { const item = document.createElement('li'); item.textContent = file; list.append(item); } attachmentPreview.append(list); }
async function loadLogs() { const payload = await requestJson('/api/logs?limit=20'); if (!payload.ok) return; logsBox.innerHTML = payload.logs.length ? payload.logs.map(renderLog).join('') : '<p class="hint">暂无日志</p>'; }
async function requestJson(url, options) { const response = await fetch(url, options); const payload = await response.json().catch(() => ({ ok: false, error: '服务器返回无效数据。' })); return { ...payload, ok: response.ok && payload.ok }; }
function getOverwriteFieldLabels(template) { const labels = { generalDescription: 'General Description', confidentialComments: 'Confidential Comments' }; return Object.entries(template.fields).filter(([, value]) => String(value || '').trim()).map(([key]) => labels[key] || key); }
function renderLog(log) {
  const reason = log.reason ? `<div>${escapeHtml(log.reason)}</div>` : '';
  const moduleResults = Array.isArray(log.moduleResults) ? log.moduleResults : [];
  const moduleSummary = moduleResults.length > 0
    ? `<div>模块：完成 ${moduleResults.filter((module) => module.status === 'completed').length}，错误 ${moduleResults.filter((module) => module.status === 'failed').length}，跳过 ${moduleResults.filter((module) => module.status === 'skipped').length}</div>`
    : '';
  return `<article class="log"><strong>${escapeHtml(log.status || '')} ${escapeHtml(log.monitoringId || '')}</strong><small>${escapeHtml(log.time || '')}</small><div>字段：${Number(log.filledFields || 0)}，附件：${Number(log.uploadedFiles || 0)}，${log.saved ? '已确认保存' : '未 Save'}</div>${moduleSummary}${reason}</article>`;
}
function setRunning(running) { for (const button of [runButton, runReportButton, saveCredentialsButton, saveTemplateButton, saveReportTemplateButton, loadAttachmentsButton, uploadAttachmentsButton, selectAllReportButton]) button.disabled = running; }
function setStatus(type, message) { statusBox.className = `status ${type}`; statusBox.textContent = message; }
function getValue(id) { return document.querySelector(`#${id}`).value.trim(); }
function setValue(id, value) { document.querySelector(`#${id}`).value = value || ''; }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
