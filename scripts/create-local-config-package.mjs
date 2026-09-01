import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureLocalTemplate, LOCAL_TEMPLATE_PATH } from '../src/localTemplateStorage.js';

const root = process.cwd();
const packageDir = path.join(root, 'delivery-packages');
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+$/, '')
  .replace('T', '-');
const packageName = `AutoForm-local-config-${timestamp}`;
const stagingDir = path.join(packageDir, packageName);
const zipPath = `${stagingDir}.zip`;

await assertFile('.runtime/credentials.json', '缺少 .runtime/credentials.json，请先在页面保存账号密码。');
await ensureLocalTemplate();
await assertFile(LOCAL_TEMPLATE_PATH, `缺少 ${LOCAL_TEMPLATE_PATH}。`);
await assertFile('data/templates/report-imported.json', '缺少 data/templates/report-imported.json，请先准备 Report 模板。');

await fs.mkdir(path.join(stagingDir, '.runtime'), { recursive: true });
await fs.mkdir(path.join(stagingDir, 'data', 'templates'), { recursive: true });

await fs.copyFile(path.join(root, '.runtime', 'credentials.json'), path.join(stagingDir, '.runtime', 'credentials.json'));
await fs.copyFile(path.join(root, LOCAL_TEMPLATE_PATH), path.join(stagingDir, 'data', 'templates', 'local-default.json'));
await fs.copyFile(path.join(root, 'data', 'templates', 'report-imported.json'), path.join(stagingDir, 'data', 'templates', 'report-imported.json'));

const credentials = JSON.parse(await fs.readFile(path.join(root, '.runtime', 'credentials.json'), 'utf8'));
await fs.writeFile(path.join(stagingDir, '.env'), [
  `AMFORI_USERNAME=${escapeEnvValue(credentials.username || '')}`,
  `AMFORI_PASSWORD=${escapeEnvValue(credentials.password || '')}`,
  ''
].join('\n'), 'utf8');

await fs.writeFile(path.join(stagingDir, 'LOCAL_CONFIG_README.md'), `# AutoForm 本地配置包

把本压缩包解压到 AutoForm 项目根目录。

## 包含内容

- \`.env\`：amfori 账号密码环境变量。
- \`.runtime/credentials.json\`：本地账号密码，供页面控制器和自动化读取。
- \`data/templates/local-default.json\`：本机 Monitoring ID 和基础模板。
- \`data/templates/report-imported.json\`：Report 23 个模块业务字段模板。

## 不包含内容

- \`.runtime/browser-profile/\`：浏览器登录态/cookies，建议在第三方电脑首次运行时重新生成。
- \`data/run-logs.jsonl\`：运行日志。
- \`data/screenshots/\`：截图。

## 使用方式

1. 先 clone GitHub 仓库并安装依赖。
2. 把本包解压到项目根目录，允许覆盖同名本地配置文件。
3. 运行 \`npm start\`。
4. 浏览器打开 \`http://127.0.0.1:3000\`。
`, 'utf8');

await removeIfExists(zipPath);
await compressDirectory(stagingDir, zipPath);
await fs.rm(stagingDir, { recursive: true, force: true });

console.log(`Created local config package: ${path.relative(root, zipPath)}`);

async function assertFile(relativePath, message) {
  try {
    const stat = await fs.stat(path.join(root, relativePath));
    if (!stat.isFile()) {
      throw new Error(message);
    }
  } catch {
    throw new Error(message);
  }
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { force: true }).catch(() => {});
}

async function compressDirectory(sourceDir, destinationPath) {
  const command = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const script = [
    '-NoProfile',
    '-Command',
    '& { param($source, $destination) Compress-Archive -Path $source -DestinationPath $destination -Force }',
    path.join(sourceDir, '*'),
    destinationPath
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(command, script, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Compress-Archive exited with code ${code}`));
      }
    });
  });
}

function escapeEnvValue(value) {
  const text = String(value);
  if (!/[\s#"']/u.test(text)) {
    return text;
  }
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
