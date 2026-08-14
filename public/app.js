const form = document.querySelector('#autoForm');
const controllerForm = document.querySelector('#controllerForm');
const runButton = document.querySelector('#runButton');
const saveCredentialsButton = document.querySelector('#saveCredentialsButton');
const saveTemplateButton = document.querySelector('#saveTemplateButton');
const loadAttachmentsButton = document.querySelector('#loadAttachmentsButton');
const uploadAttachmentsButton = document.querySelector('#uploadAttachmentsButton');
const refreshLogsButton = document.querySelector('#refreshLogsButton');
const statusBox = document.querySelector('#status');
const resultBox = document.querySelector('#resultBox');
const logsBox = document.querySelector('#logs');
const attachmentPreview = document.querySelector('#attachmentPreview');

let attachmentPreviewState = null;

await loadTemplate();
await loadLogs();

controllerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runTask();
});

saveTemplateButton.addEventListener('click', async () => {
  await saveTemplate();
});

saveCredentialsButton.addEventListener('click', async () => {
  await saveCredentials();
});

loadAttachmentsButton.addEventListener('click', async () => {
  await loadAttachments();
});

uploadAttachmentsButton.addEventListener('click', async () => {
  await uploadAttachmentsOnly();
});

refreshLogsButton.addEventListener('click', async () => {
  await loadLogs();
});

document.querySelector('#attachmentFolder').addEventListener('input', clearAttachmentPreview);
document.querySelector('#monitoringId').addEventListener('input', clearAttachmentPreview);

async function loadTemplate() {
  const response = await fetch('/api/template');
  const payload = await response.json();
  if (!payload.ok) {
    setStatus('failed', payload.error || '模板读取失败');
    return;
  }

  const template = payload.template;
  setValue('username', template.credentials?.username);
  setValue('password', template.credentials?.password);
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

async function saveCredentials() {
  const credentials = {
    username: getValue('username'),
    password: getValue('password')
  };

  if (!credentials.username || !credentials.password) {
    setStatus('failed', '请输入 amfori 账号和密码后再保存');
    return;
  }

  const response = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials })
  });
  const payload = await response.json();

  if (payload.ok) {
    setStatus('success', '登录信息已写入本地文件');
  } else {
    setStatus('failed', payload.error || '登录信息保存失败');
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
      ? '附件不会在本次表单任务中上传；请使用“加载附件文件”和“确认仅上传附件”。'
      : '附件上传任务与表单填写任务相互独立。',
    '会优先使用本机持久化登录态；登录态失效时会使用已保存的本地账号密码自动登录。',
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
      setStatus('success', payload.result?.saved === false ? '执行成功，无内容需要 Save' : '执行成功，已确认保存');
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

async function loadAttachments() {
  const attachmentFolder = getValue('attachmentFolder');
  if (!attachmentFolder) {
    setStatus('failed', '请先填写附件文件夹路径');
    return;
  }

  loadAttachmentsButton.disabled = true;
  attachmentPreview.textContent = '正在读取文件夹...';

  try {
    const response = await fetch('/api/attachments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachmentFolder })
    });
    const payload = await response.json();
    if (!payload.ok) {
      attachmentPreview.textContent = payload.error || '附件读取失败';
      setStatus('failed', payload.error || '附件读取失败');
      return;
    }

    attachmentPreviewState = {
      attachmentFolder,
      monitoringId: getValue('monitoringId'),
      files: payload.files
    };
    renderAttachmentPreview(payload.files);
    uploadAttachmentsButton.disabled = payload.files.length === 0;
    setStatus('success', `已检测到 ${payload.files.length} 个附件文件`);
  } catch (error) {
    attachmentPreview.textContent = error.message;
    setStatus('failed', error.message);
  } finally {
    loadAttachmentsButton.disabled = false;
  }
}

async function uploadAttachmentsOnly() {
  const monitoringId = getValue('monitoringId');
  const attachmentFolder = getValue('attachmentFolder');
  if (!monitoringId) {
    setStatus('failed', '请输入 Monitoring ID 后再上传附件');
    return;
  }
  if (!attachmentPreviewState || attachmentPreviewState.attachmentFolder !== attachmentFolder || attachmentPreviewState.monitoringId !== monitoringId) {
    setStatus('failed', '附件路径或 Monitoring ID 已变化，请重新加载附件文件');
    return;
  }

  const confirmed = window.confirm(
    `将只向项目 ${monitoringId} 上传以下 ${attachmentPreviewState.files.length} 个附件。\n不会填写或覆盖 General Description 和 Report。\n确认上传吗？`
  );
  if (!confirmed) {
    setStatus('idle', '已取消附件上传');
    return;
  }

  setRunning(true);
  setStatus('running', '正在上传附件，Playwright 浏览器会自动打开');
  resultBox.textContent = '';

  try {
    const response = await fetch('/api/attachments/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monitoringId,
        attachmentFolder,
        fileNames: attachmentPreviewState.files
      })
    });
    const payload = await response.json();
    if (payload.ok) {
      setStatus('success', `附件上传成功，已确认保存 ${payload.result.uploadedFiles} 个文件`);
    } else {
      setStatus('failed', payload.error || payload.result?.reason || '附件上传失败');
    }

    resultBox.textContent = JSON.stringify(payload.result || payload, null, 2);
    await loadLogs();
  } catch (error) {
    setStatus('failed', error.message);
  } finally {
    setRunning(false);
  }
}

function clearAttachmentPreview() {
  attachmentPreviewState = null;
  uploadAttachmentsButton.disabled = true;
  attachmentPreview.textContent = '文件夹路径或项目 ID 已变更，请重新加载附件文件。';
}

function renderAttachmentPreview(files) {
  if (files.length === 0) {
    attachmentPreview.textContent = '文件夹为空，没有可上传的文件。';
    return;
  }

  attachmentPreview.innerHTML = `
    <strong>检测到 ${files.length} 个文件</strong>
    <ul>${files.map((file) => `<li>${escapeHtml(file)}</li>`).join('')}</ul>
  `;
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
    credentials: {
      username: getValue('username'),
      password: getValue('password')
    },
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
  const saved = log.saved ? '已确认保存' : '未 Save';
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
  saveCredentialsButton.disabled = isRunning;
  saveTemplateButton.disabled = isRunning;
  loadAttachmentsButton.disabled = isRunning;
  uploadAttachmentsButton.disabled = isRunning || !attachmentPreviewState;
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
