# AutoForm 第三方使用手册

本文档给第三方使用 AutoForm 时参考。AutoForm 是本地运行的 amfori 自动填表工具，不部署服务器，不需要数据库。

项目 GitHub 地址：<https://github.com/chenyanglonglive-cyber/AutoForm.git>

## 1. 准备环境

请先安装：

- Windows 10 或 Windows 11
- Git
- Node.js 18+，推荐 Node.js 20+ 或 24
- npm，随 Node.js 一起安装

确认安装成功：

```powershell
git --version
node --version
npm --version
```

电脑需要能访问：

```text
https://platform.amfori.org
```

## 2. 获取代码

在你希望存放项目的目录打开 PowerShell：

```powershell
git clone https://github.com/chenyanglonglive-cyber/AutoForm.git
cd AutoForm
```

安装依赖：

```powershell
npm install
npx playwright install chromium
```

## 3. 放入本地配置包

项目提供方会另外给你一个本地配置压缩包，名称类似：

```text
AutoForm-local-config-YYYYMMDD-HHMMSS.zip
```

把压缩包解压到 `AutoForm` 项目根目录。解压后应能看到：

```text
AutoForm/
  .env
  .runtime/
    credentials.json
  data/
    templates/
      local-default.json
      report-imported.json
```

说明：

- `.env` 保存 amfori 账号密码环境变量。
- `.runtime/credentials.json` 保存页面控制器使用的本地账号密码。
- `data/templates/report-imported.json` 保存 Report 23 个模块的本地业务字段值。
- `data/templates/local-default.json` 保存本机 `Monitoring ID` 和基础表单模板；它不会被 GitHub 更新覆盖。

如果提供方没有给账号密码，你也可以启动页面后在右侧控制器手动填写账号密码，并点击保存本地登录信息。

## 4. 启动程序

在项目根目录运行：

```powershell
npm start
```

看到类似下面的提示后，打开浏览器：

```text
amfori Auto Form is running at http://127.0.0.1:3000
```

访问：

```text
http://127.0.0.1:3000
```

也可以双击项目根目录的 `AutoForm.lnk` 或 `Start-AutoForm.cmd` 启动。

## 5. 首次登录

程序使用 Playwright 打开 amfori 页面。

- 如果 `.runtime/browser-profile/` 里已有有效登录态，会自动复用。
- 如果登录态失效，会使用 `.runtime/credentials.json` 或 `.env` 中的账号密码登录。
- 如果账号密码缺失或登录失败，需要在打开的浏览器里手动登录。

登录态只保存在本机 `.runtime/browser-profile/`，不会上传到 GitHub。

## 6. 使用 General Description

1. 打开 `http://127.0.0.1:3000`。
2. 在右侧确认 `Monitoring ID`。
3. 填写左侧 General Description 相关内容。
4. 点击开始执行。

规则：

- 空字段会跳过，不覆盖网页内容。
- 有内容的字段会写入真实 amfori 页面。
- 执行前请确认目标 `Monitoring ID` 正确。

## 7. 使用 Report

在页面的 Report 工作区：

1. 点击模块名称查看该模块字段。
2. 修改字段后点击保存 Report 模板，只会保存到本机 JSON。
3. 勾选要执行的模块。
4. 点击执行已选 Report 模块。

规则：

- 只执行已勾选的模块。
- 每个模块填写后会单独 Save。
- 保存后会刷新并校验。
- 遇到失败会停止，避免继续影响后续模块。

重要提醒：

- 当前已做过 23 个模块无保存 dry-run 测试。
- PA1-PA13 的问题答案、Evidence 复选框、Finding/Advance 区域已页面内校验通过。
- `Remuneration and Working Hours` 中有 3 个 GLWC 条件隐藏字段需要按业务情况单独确认。

## 8. 使用 Report Attachments

1. 在 `Report Attachments` 输入附件文件夹路径。
2. 点击加载附件文件，检查文件名。
3. 确认无误后点击确认仅上传附件。

规则：

- 只上传当前预览出来的文件。
- 修改附件路径或 `Monitoring ID` 后，需要重新加载附件。
- 附件上传不会填写 Report 文本字段。

## 9. 更新代码

项目提供方更新代码后，在项目目录运行：

```powershell
git pull
npm install
npx playwright install chromium
```

然后运行 `npm start`。若 Chromium 已安装，第三行可跳过；如果出现“browser executable does not exist”，运行该行即可。首次升级到此版本时，程序会把旧 `default.json` 的现有内容自动迁移到 Git 忽略的 `local-default.json`；Report 模板、账号、日志和截图也都会保留。

如果依赖有变化，再运行：

```powershell
npm install
```

然后重新启动：

```powershell
npm start
```

## 10. 更新本地模板或账号

如果提供方更新了业务模板，需要重新覆盖：

```text
data/templates/report-imported.json
```

如果账号密码变化，可以任选一种方式：

- 在页面右侧控制器重新填写账号密码并保存。
- 覆盖 `.runtime/credentials.json`。
- 覆盖 `.env`。

## 11. 本地数据说明

AutoForm 没有数据库。

主要本地数据：

- `.runtime/credentials.json`：账号密码。
- `.runtime/browser-profile/`：本机浏览器登录态。
- `data/templates/local-default.json`：本机基础模板。
- `data/templates/report-imported.json`：Report 业务模板。
- `data/run-logs.jsonl`：运行日志。
- `data/screenshots/`：失败截图。

不要把 `.env`、`.runtime/`、`data/templates/local-default.json`、`data/templates/report-imported.json`、日志或截图上传到公开仓库。

## 12. 常用检查

检查代码是否能正常加载：

```powershell
npm run check
```

无保存 Report 检查：

```powershell
npm run dry-run:report
```

只打开/展开模块、不填写字段：

```powershell
npm run dry-run:report:open-only
```

无保存检查会登录 amfori，并在登录后拦截写请求；只打开/展开模式不会填写字段。
