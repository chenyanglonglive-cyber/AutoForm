const form = document.querySelector('#autoForm');
const controllerForm = document.querySelector('#controllerForm');
const runButton = document.querySelector('#runButton');
const saveTemplateButton = document.querySelector('#saveTemplateButton');
const refreshLogsButton = document.querySelector('#refreshLogsButton');
const statusBox = document.querySelector('#status');
const resultBox = document.querySelector('#resultBox');
const logsBox = document.querySelector('#logs');

await loadTemplate();
await loadLogs();

controllerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runTask();
});

saveTemplateButton.addEventListener('click', async () => {
  await saveTemplate();
});

refreshLogsButton.addEventListener('click', async () => {
  await loadLogs();
});

async function loadTemplate() {
  const response = await fetch('/api/template');
  const payload = await response.json();
  if (!payload.ok) {
    setStatus('failed', payload.error || '模板读取失败');
    return;
  }

  const template = payload.template;
  setValue('monitoringId', template.monitoringId);
  setValue('attachmentFolder', template.attachmentFolder);
  setValue('generalDescription', template.fields?.generalDescription);
  setValue('confidentialComments', template.fields?.confidentialComments);
}

async function saveTemplate() {
  if (!validateForms()) {
    return;
  }

  const template = readFormTemplate();
  const response = await fetch('/api/template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template)
  });
  const payload = await response.json();
  if (payload.ok) {
    setStatus('success', '模板已保存');
  } else {
    setStatus('failed', payload.error || '模板保存失败');
  }
}

async function runTask() {
  if (!validateForms()) {
    return;
  }

  const template = readFormTemplate();
  const overwriteFields = getOverwriteFieldLabels(template);
  const hasAttachments = Boolean(template.attachmentFolder);
  const confirmLines = [
    '本次执行会打开 amfori 并处理当前 Monitoring ID。',
    overwriteFields.length > 0
      ? `以下本地字段有内容，会覆盖网页原内容：${overwriteFields.join('、')}`
      : '所有表单字段为空，将跳过字段填写。',
    hasAttachments
      ? '附件文件夹有路径，会尝试上传该文件夹内的文件；如果文件夹为空则跳过上传。'
      : '附件文件夹为空，将跳过附件上传。',
    '确认继续吗？'
  ];

  if (!window.confirm(confirmLines.join('\n'))) {
    setStatus('idle', '已取消执行');
    return;
  }

  setRunning(true);
  setStatus('running', '正在执行，Playwright 浏览器会自动打开');
  resultBox.textContent = '';

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template)
    });
    const payload = await response.json();

    if (payload.ok) {
      setStatus('success', payload.result?.saved === false ? '执行成功，无内容需要 Save' : '执行成功，已点击 Save');
    } else {
      setStatus('failed', payload.error || payload.result?.reason || '执行失败');
    }

    resultBox.textContent = JSON.stringify(payload.result || payload, null, 2);
    await loadLogs();
  } catch (error) {
    setStatus('failed', error.message);
  } finally {
    setRunning(false);
  }
}

async function loadLogs() {
  const response = await fetch('/api/logs?limit=20');
  const payload = await response.json();
  if (!payload.ok) {
    logsBox.textContent = payload.error || '日志读取失败';
    return;
  }

  if (payload.logs.length === 0) {
    logsBox.innerHTML = '<p class="hint">暂无日志</p>';
    return;
  }

  logsBox.innerHTML = payload.logs.map(renderLog).join('');
}

function readFormTemplate() {
  return {
    monitoringId: getValue('monitoringId'),
    attachmentFolder: getValue('attachmentFolder'),
    fields: {
      generalDescription: getValue('generalDescription'),
      confidentialComments: getValue('confidentialComments')
    }
  };
}

function validateForms() {
  if (!controllerForm.reportValidity()) {
    return false;
  }

  return form.reportValidity();
}

function getOverwriteFieldLabels(template) {
  const labels = {
    generalDescription: 'General Description',
    confidentialComments: 'Confidential Comments'
  };

  return Object.entries(template.fields || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([key]) => labels[key] || key);
}

function renderLog(log) {
  const status = escapeHtml(log.status || '');
  const id = escapeHtml(log.monitoringId || '');
  const reason = log.reason ? `<div>${escapeHtml(log.reason)}</div>` : '';
  const screenshot = log.screenshot ? `<div>截图：${escapeHtml(log.screenshot)}</div>` : '';
  const saved = log.saved ? '已 Save' : '未 Save';
  return `
    <article class="log">
      <strong>${status} ${id}</strong>
      <small>${escapeHtml(log.time || '')}</small>
      <div>字段：${Number(log.filledFields || 0)}，附件：${Number(log.uploadedFiles || 0)}，${saved}</div>
      ${reason}
      ${screenshot}
    </article>
  `;
}

function setRunning(isRunning) {
  runButton.disabled = isRunning;
  saveTemplateButton.disabled = isRunning;
}

function setStatus(type, message) {
  statusBox.className = `status ${type}`;
  statusBox.textContent = message;
}

function getValue(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function setValue(id, value) {
  document.querySelector(`#${id}`).value = value || '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
