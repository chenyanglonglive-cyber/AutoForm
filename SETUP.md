# 环境搭建清单（给接手 agent）

这份清单让一个全新的 agent 能从「空目录 / 干净 clone」一路把项目跑起来。按顺序执行即可，每一步都标了**为什么**和**怎么验证**。

项目 GitHub 地址：<https://github.com/chenyanglonglive-cyber/AutoForm.git>

> 项目定位：本地 Windows 上运行的 amfori 自动填表工具，Node.js + Playwright，不部署线上、不用数据库。核心是「本地 Report 模板结构与目标 amfori 页面结构对齐，供人工逐项对照并回填真实项目」。

---

## 0. 前置条件

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows 10/11（作者在 Win11 开发） | 核心逻辑跨平台，但登录态与一键启动脚本按 Windows 写 |
| Node.js | **18+**（作者用 24） | 项目是 ESM（`package.json` 有 `"type":"module"`），用了顶层 `await` |
| 浏览器 | Chromium（由 Playwright 下载，见第 2 步） | 用于自动化填表和采集，本地编辑页面用系统默认浏览器即可 |
| 网络 | 能访问 `platform.amfori.org` | 只有「采集 / 真实填表」才需要；仅启动本地编辑器不需要 |

验证 Node 版本：

```powershell
node -v
npm -v
```

---

## 1. 获取代码并安装依赖

```powershell
cd D:\AIcode-hub\AutoForm
npm install
```

- 装的是 `playwright`（package.json 唯一运行时依赖）。**本机服务本身用 `node:http`/`node:fs`，不依赖浏览器**，所以这步完成后就能启动本地页面。
- 会生成 `node_modules/` 和 `package-lock.json`（`node_modules/` 已被 git 忽略）。

---

## 2. 下载 Playwright 浏览器（运行自动化 / 采集才需要）

```powershell
npx playwright install chromium
```

- **最容易漏的一步**。`npm install` 只装 npm 包，不下载浏览器二进制。
- 如果只想先看本地编辑页面、暂不跑真实填表，可以跳过这步；一旦要执行采集脚本或「执行已选 Report 模块」，就必须先装。

---

## 3. 配置文件（已提交，通常无需改动）

以下文件随代码一起提交，clone 后已就位，仅当你需要改平台地址 / 选择器时才动：

```text
config/settings.json          平台地址、登录选择器、浏览器 profile 路径、超时
config/field-mapping.json     General Description / Report / 附件的 tab 与字段 selector
data/templates/default.json         GitHub 发布的出厂默认模板
data/templates/local-default.json   本机业务模板（monitoringId、附件目录、General Description 字段，自动生成且忽略）
public/                       本地前端（index.html / app.js / styles.css）
src/                          本机 HTTP 服务、存储、Report 读写、自动化 bot
```

`config/settings.json` 关键项（不要随意改）：

- `amfori.browserUserDataDir` = `.runtime/browser-profile`（登录态位置）
- `server.port` = `3000`
- `login.usernameSelector` / `passwordSelector` / `submitSelector`

---

## 4. 数据文件：哪些已提交、哪些要再生成

这是本项目最容易困惑的地方——**git 忽略的产物需要现场生成**。三者的依赖关系是一条流水线：

```text
scrape_report_full.mjs      →  data/report_schema.json         （原始采集快照，忽略）
scrape_report_layout.mjs    →  data/report-layout/modules/*.json（布局树，忽略）
scrape_report_options.mjs   →  data/report-layout/options.json （ui-select 候选项，忽略）
scripts/build-report-schema.mjs → data/report-schema/（已构建 schema，应提交）
                               + data/templates/local-default.json / report-imported.json（本机当前值模板，忽略）
```

| 路径 | 性质 | 作用 | 缺失时怎么办 |
| --- | --- | --- | --- |
| `data/report-schema/` | 应提交（无值 schema） | 本地编辑器懒加载 23 模块的字段/表格/布局 | 若 clone 后缺失：见第 5 步重建 |
| `data/report_schema.json` | 忽略 | 原始采集快照，重建 schema 的输入 | 跑 `scrape_report_full.mjs` |
| `data/report-layout/` | 忽略 | 每模块章节/分组/表格/选项组布局 + ui-select 候选项 | 跑 `scrape_report_layout.mjs` + `scrape_report_options.mjs` |
| `data/templates/report-imported.json` | 忽略 | 本机 Report 当前已填值 | 缺失时服务自动回退为空模板，无需手动建 |
| `data/templates/local-default.json` | 忽略 | 本机 Monitoring ID、附件路径和基础表单值 | 首次启动时从 `default.json` 自动迁移 |
| `.runtime/credentials.json` | 忽略 | amfori 账号密码（本机） | 在 UI「保存本地登录信息」，或手动建 |
| `.runtime/browser-profile/` | 忽略 | Playwright 登录态 | 首次运行自动化时自动登录生成 |
| `data/run-logs.jsonl` / `data/screenshots/` | 忽略 | 运行日志 / 失败截图 | 服务启动时自动创建 |

**判断你需不需要再生成**：先看 `data/report-schema/index.json` 存不存在。

- 存在 → 本地编辑器能直接跑，跳到第 6 步。
- 不存在（干净 clone 且该目录没提交）→ 走第 5 步完整重建。

---

## 5. 完整重建 schema（仅在数据缺失或需重采时）

需要 amfori 账号登录态，且目标项目可访问。

### 5.1 准备凭据

先在 UI 填一次账号密码并「保存本地登录信息」，或手动创建 `.runtime/credentials.json`：

```json
{ "username": "你的amfori账号", "password": "你的密码" }
```

### 5.2 指定目标 Monitoring ID

采集脚本从 `data/templates/local-default.json` 的 `monitoringId` 读目标项目。**先改成你要操作的那个项目**（在 UI 的 `Monitoring ID` 输入框保存即可）。

> 安全规则：每次只操作**一个** `Monitoring ID`，采集脚本只读、不写真实数据。

### 5.3 依次采集 + 构建

```powershell
# 1) 原始字段快照（含字段 id/type/selector/选项值/表格样本）
node scrape_report_full.mjs

# 2) 页面结构布局（章节/分组/选项组/表格行列 + 单元格内控件坐标）
node scrape_report_layout.mjs

# 3) ui-select 动态下拉候选项（按内容去重为来源组）
node scrape_report_options.mjs

# 4) 由快照 + 布局 + 候选项 构建最终 schema 与本机模板
npm run build:report-schema
```

三个采集脚本都**支持断点续跑**（已采集的模块跳过）；`scrape_report_layout.mjs` 每模块采集完会刷新回 report-sections 丢弃临时输入态。

### 5.4 校验

```powershell
npm run validate:config
node scripts/validate-report-schema.mjs
```

后一条应输出：

```text
Modules: 23 (23 with layout)
Fields: raw=1302 built=1302
✅ 字段集不变性校验通过：模块数、字段数、key 集合、selector/type/uiSelectIndex、layout 引用均一致。
```

---

## 6. 启动本地服务

```powershell
npm start
```

看到 `amfori Auto Form is running at http://127.0.0.1:3000` 即成功。浏览器打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)（或用根目录 `AutoForm.lnk` 一键启动）。

**冒烟自检**（本地编辑器是否正常，不碰真实站点）：

```powershell
curl -s http://127.0.0.1:3000/api/report/index
# 应返回 {"ok":true,"index":{"version":1,"modules":[...23 项...]}}
```

---

## 7. 运行真实自动化前的最后检查

「执行已选 Report 模块」/「开始执行」/「确认仅上传附件」都会启动 Playwright 打开真实 amfori 页。跑之前确认：

- [ ] 第 2 步已下载 Chromium（`npx playwright install chromium`）
- [ ] `.runtime/credentials.json` 有账号密码（或已通过 UI 保存）
- [ ] `.runtime/browser-profile/` 存在且登录态有效（失效时脚本会尝试自动登录）
- [ ] `data/templates/local-default.json` 的 `monitoringId` 是要操作的项目

> 首次运行可能弹出手动登录窗口，观察浏览器里是否已登录到 amfori 待办页。

---

## 8. 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npx playwright install chromium` | 下载自动化浏览器 |
| `npm start` | 启动本地服务（127.0.0.1:3000） |
| `npm run check` | 语法检查所有 JS/MJS 文件 |
| `npm run validate:config` | 校验 settings / field-mapping / default 模板 |
| `npm run build:report-schema` | 重建 Report schema（需 raw 快照 + layout） |
| `node scripts/validate-report-schema.mjs` | 字段集不变性校验 |
| `node scrape_report_full.mjs` | 采集原始字段快照 |
| `node scrape_report_layout.mjs` | 采集页面结构布局 |
| `node scrape_report_options.mjs` | 采集 ui-select 候选项 |

---

## 9. 常见问题

- **端口被占用 `EADDRINUSE 3000`**：已有实例在跑；关掉旧的或改 `config/settings.json` 的 `server.port`。
- **`launchPersistentContext` 报找不到浏览器**：没跑 `npx playwright install chromium`。
- **登录态失效 / 采集脚本卡在登录**：删 `.runtime/browser-profile/` 后重跑，脚本会走账号密码自动登录；或先手动登录一次。
- **`Report schema 读取失败`**：`data/report-schema/` 缺失，走第 5 步重建。
- **采集脚本只读安全**：采集器登录后 `page.route` 拦截并 abort 非 GET 写请求；不会触发线上 Save。不要删掉这层拦截。
- **不要提交**：`.runtime/`、`data/report_schema.json`、`data/report-layout/`、`data/templates/local-default.json`、`data/templates/report-imported.json`、`data/run-logs.jsonl`、`data/screenshots/*`、`node_modules/`（详见 `.gitignore`）。

---

## 10. 相关文档

- 项目功能与进度：[README.md](README.md)
- 技术路径、结构对齐状态与接手步骤：[PROJECT_HANDOFF.md](PROJECT_HANDOFF.md)
