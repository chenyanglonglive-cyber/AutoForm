# AutoForm 交付清单

本文档用于把 AutoForm 交付给第三方使用时核对文件、账号、环境和更新方式。

## 交付方式

推荐分成两部分交付：

1. 代码仓库：通过 GitHub 克隆和后续更新。
2. 本地配置包：通过单独压缩包交付，不上传 GitHub。

GitHub 克隆地址：

```text
https://github.com/chenyanglonglive-cyber/AutoForm.git
```

## 已放入 GitHub 的内容

- 前端页面：`public/`
- 本地服务与自动化逻辑：`src/`
- 脚本：`scripts/`
- 平台配置：`config/`
- Report 结构 schema：`data/report-schema/`
- 基础模板：`data/templates/local-default.json`
- 环境变量示例：`.env.example`
- 使用和交接文档：`README.md`、`SETUP.md`、`PROJECT_HANDOFF.md`、`THIRD_PARTY_USER_MANUAL.md`

## 不上传 GitHub、需单独打包的内容

这些内容包含账号、业务填充值或本机运行数据，不应提交到 Git：

- `.env`
- `.runtime/credentials.json`
- `data/templates/report-imported.json`

可选但不建议交付：

- `.runtime/browser-profile/`：浏览器登录态，含 cookies/session，跨电脑不一定稳定。建议第三方第一次运行时用账号重新登录生成自己的登录态。
- `data/run-logs.jsonl`：运行日志，不需要。
- `data/screenshots/`：截图，不需要，除非要说明历史问题。

## 本地配置包内容

生成本地配置包：

```powershell
npm run package:local-config
```

本次交付压缩包命名格式：

```text
AutoForm-local-config-YYYYMMDD-HHMMSS.zip
```

压缩包内应包含：

```text
.env
.runtime/
  credentials.json
data/
  templates/
    local-default.json
    report-imported.json
LOCAL_CONFIG_README.md
```

## 第三方环境清单

不需要 Docker。第三方电脑安装以下环境即可：

- Windows 10 或 Windows 11
- Node.js 18+，推荐 Node.js 20+ 或 24
- npm
- Git
- 可访问 `https://platform.amfori.org`
- 一个可登录 amfori 的账号
- 本机端口 `3000` 未被占用

## 第三方安装命令

```powershell
git clone https://github.com/chenyanglonglive-cyber/AutoForm.git
cd AutoForm
npm install
npx playwright install chromium
```

然后把本地配置包解压到项目根目录，确保 `.env`、`.runtime/credentials.json`、`data/templates/local-default.json`、`data/templates/report-imported.json` 出现在对应位置。

启动：

```powershell
npm start
```

浏览器打开：

```text
http://127.0.0.1:3000
```

## 后续更新方式

代码更新：

```powershell
git pull
npm install
npm start
```

说明：

- 如果只是代码、页面、脚本更新，通常 `git pull` 后直接 `npm start` 即可；首次升级到本版本时，服务会把原 `default.json` 的现有内容自动迁移到 Git 忽略的 `local-default.json`。
- 如果 `package.json` 或 `package-lock.json` 更新，对方需要再运行 `npm install`。
- 如果首次安装或报错提示浏览器可执行文件不存在，对方还需要运行 `npx playwright install chromium`。
- 如果你更新了 `data/templates/report-imported.json` 里的业务模板，需要重新发送本地配置包，或单独发送这个 JSON 文件。
- 账号密码变化时，可以让对方在页面右侧控制器重新保存，也可以重新发送 `.env` 或 `.runtime/credentials.json`。

## 数据存储说明

当前项目没有数据库。

本地数据通过 JSON / JSONL 文件保存：

- `.runtime/credentials.json`：本机 amfori 账号密码。
- `.runtime/browser-profile/`：Playwright 持久化浏览器登录态。
- `data/templates/local-default.json`：本机基础模板，包含 `Monitoring ID` 和附件路径。
- `data/templates/report-imported.json`：Report 23 个模块的本地业务字段值。
- `data/run-logs.jsonl`：运行日志。

其中账号、业务模板、日志和截图默认不提交到 Git。

## 交付前检查

交付前在你的电脑执行：

```powershell
npm run check
git status --short
```

确认：

- `npm run check` 通过。
- Git 中没有 `.env`、`.runtime/`、`data/templates/local-default.json`、`data/templates/report-imported.json`。
- 本地配置包已生成并单独发送给第三方。
