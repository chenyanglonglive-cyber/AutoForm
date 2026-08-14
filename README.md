# amfori Auto Form

本项目是一个只在本机运行的 amfori 自动填表工具。

技术路线：

- 本地页面：原生 HTML/CSS/JavaScript
- 本地服务：Node.js 内置 HTTP 服务
- 自动化：Playwright
- 数据：JSON
- 日志：JSONL

第一版只处理三个模块：

- General Description
- Report
- Report Attachments

## 启动

```powershell
npm install
npm start
```

打开：

```text
http://127.0.0.1:3000
```

如果当前机器已经有上级目录的 `playwright` 依赖，可能无需重新安装即可运行。项目本身不依赖 Python、不使用 SQLite。

## 登录

工具不会把 amfori 账号密码写入代码、日志或可提交模板。控制器里的账号密码会保存在本机文件 `.runtime/credentials.json`，用于登录态失效时自动填写登录页。

Playwright 会使用本地浏览器 profile 持久保存登录状态，不需要每次重新登录：

```text
.runtime/browser-profile
```

也仍可以临时用环境变量自动填写登录页：

```powershell
$env:AMFORI_USERNAME="your.email@example.com"
$env:AMFORI_PASSWORD="your-password"
npm start
```

## 配置

主要配置文件：

- `config/settings.json`
- `config/field-mapping.json`
- `data/templates/default.json`

amfori 页面字段的 selector 需要在真实页面中确认后更新。若字段找不到，程序会停止、截图、写日志，不会继续点击 Save。

## 运行规则

- 每次只处理一个 Monitoring ID。
- 表单字段为空时跳过，不会覆盖网页原内容。
- 表单字段有内容时会覆盖网页原内容，执行前会弹窗确认。
- 附件文件夹为空时跳过附件上传。
- 附件文件夹有文件时，文件夹内全部文件会上传到 Report Attachments。
- 有字段填写或附件上传成功后才点击 Save；全部为空时不点击 Save。
- 失败截图保存在 `data/screenshots/`。
- 执行日志写入 `data/run-logs.jsonl`。
