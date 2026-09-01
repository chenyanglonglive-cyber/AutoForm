# amfori Auto Form

个人 Windows 电脑本地运行的 amfori 自动填表工具。它根据本地模板和一个 `Monitoring ID` 打开对应项目，再将确认过的内容写入真实 amfori 页面。

项目 GitHub 地址：<https://github.com/chenyanglonglive-cyber/AutoForm.git>

工具不部署线上，不使用 Python、数据库或 SQLite。账号、浏览器登录态、导入值模板和运行日志均只保留在本机。

## 当前范围

- `General Description`：填写文本字段并保存。
- `Report`：23 个业务模块的本地模板、模块选择和逐模块自动化。
- `Report Attachments`：独立加载、预览并上传指定文件夹中的附件。

不处理 `Details`、`Closing Meeting`、`Previous Monitorings`。

## 当前进度

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 本地登录信息与持久化浏览器登录 | 已验证 | 优先复用浏览器 profile，失效时使用本机凭据重新登录。 |
| General Description 填写与保存校验 | 已验证 | 已在真实项目验证成功提示和刷新后持久化。 |
| Report Attachments 独立上传 | 已验证 | 先显示文件名，再确认上传；不会填写文本字段。 |
| Report 23 模块 schema | 已完成 | 23 个模块、1,302 个可编辑字段、46 个固定表格结构。 |
| Report 本地编辑器与逐模块保存流程 | 已实现 | 支持选择模块、保存本地模板、逐模块 Save、刷新校验、失败停止。 |
| Report 23 模块无保存 dry-run | 已验证，有 1 项待处理 | 23 个模块全部能打开；PA1-PA13 全部填写并在页面内校验通过；未点击 Save，登录后写请求已拦截。仅 `Remuneration and Working Hours` 有 3 个条件隐藏字段未出现，见下方专项记录。 |
| 动态搜索下拉选项采集 | 已完成 | 90 个 `ui-select` 已展开采集，按内容去重为 20 组候选项源，全部为完整固定列表。 |
| 本地页面与目标 Report 结构对齐 | 已采集并校验 | 23 模块的章节/分组/选项组/表格布局已采集并重建 schema；表格内无 id 的 ui-select 已按单元格绑定（兜底区为空），字段集不变性校验通过；待人工对照目标页核验。 |

### Report dry-run 测试记录（2026-08-16）

本轮使用当前本地模板和当前 `Monitoring ID` 做 23 个 Report 模块无保存测试。测试方式是在登录后拦截所有 `POST / PUT / PATCH / DELETE` 写请求，只在页面 DOM 内填入并读回校验，不点击 Save，不做刷新持久化校验。

- 23 个模块全部能打开。
- PA1-PA13 全部通过，包括每道 PA 问题的 `Yes / Partially / No / N/A` 答案、右侧 Evidence 复选框，以及展开后的 Finding/Advance 区域。
- 页面内校验成功字段：1,056 个。
- 跳过模块：`Housing Information`、`Young Worker Data`，原因是当前模板没有真实填写值。
- 安全记录：测试期间未点击 Save；写请求拦截计数为 50。

未通过字段集中在 `Remuneration and Working Hours`，共 3 个：

| 字段 key | 标签 | 模板值 | 当前判断 |
| --- | --- | --- | --- |
| `LivingWagePleaseaddthelinkofGlwCSource` | `Please add the link of GLWC source.` | `The reference can be found in below link: https://www.globallivingwage.org/.` | 当前页面未渲染该输入框。 |
| `CalculatedLivingWagePleaseEnterMonthAndYearGlwc-month` | `Month` | `string:09` | 当前页面未渲染该月份下拉框。 |
| `CalculatedLivingWagePleaseEnterMonthAndYearGlwc-year` | `Year` | `2024` | 当前页面未渲染该年份输入框。 |

这 3 个字段不是 PA 结构问题，也不是普通 selector 失效。截图显示当前页面 `Source of data` 为 `Manually collected by auditee`；上述 GLWC 链接和年月字段更像是依赖前置选项的条件字段。当前模板中对应前置字段为空，因此 dry-run 没有强行切换前置选项，以免改变业务含义。后续只需针对 `Remuneration and Working Hours` 做专项确认，不需要再全量跑 23 个模块。

## 启动

全新环境的搭建与数据重建清单见 [SETUP.md](SETUP.md)。
第三方交付和使用说明见 [DELIVERY_CHECKLIST.md](DELIVERY_CHECKLIST.md) 与 [THIRD_PARTY_USER_MANUAL.md](THIRD_PARTY_USER_MANUAL.md)。

安装依赖后运行：

```powershell
npm install
npm start
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。根目录的 `AutoForm.lnk` 也可用于一键启动。

检查项目：

```powershell
npm run check
npm run validate:config
```

## 使用方式

### 1. 保存登录信息

在右侧控制器填写 amfori 账号和密码，点击“保存本地登录信息”。

- 凭据仅写入 `.runtime/credentials.json`。
- 点击保存不会打开浏览器。
- 实际任务运行时，Playwright 优先复用 `.runtime/browser-profile` 的登录态。

### 2. 填写 General Description

填写左侧文本字段和右侧 `Monitoring ID`，点击“开始执行”。

- 空文本字段跳过，不覆盖网页内容。
- 有内容的字段会覆盖目标字段，执行前显示确认提示。
- 该按钮不上传附件，也不执行 Report。

### 3. 上传附件

在 `Report Attachments` 输入文件夹路径，先点击“加载附件文件”确认文件名，再点击“确认仅上传附件”。

- 路径或 `Monitoring ID` 改变后必须重新加载。
- 上传任务只处理附件，不会覆盖 General Description 或 Report。

### 4. 编辑和执行 Report

在 `Report` 工作区点击一个模块名称后才加载该模块字段；通过模块左侧勾选框选择需要执行的模块。

- “保存 Report 模板”只保存本地模板。
- “执行已选 Report 模块”只运行已勾选的模块。
- 自动化从当前 `Monitoring ID` 动态进入真实 Report 页面，不使用采集项目的绝对 URL。
- 每个模块填写后单独点击真实 Save，刷新并校验后再继续下一个模块。
- 遇到失败立即停止，日志会记录已完成模块，重新勾选失败模块即可续跑。

## 数据与文件

```text
config/
  settings.json                     平台、登录、超时和浏览器设置
  field-mapping.json                General Description 与附件映射
data/
  report-schema/index.json          23 个 Report 模块索引
  report-schema/modules/*.json      无值的字段、表格和定位 schema
  report-layout/                    每模块章节/分组/表格/选项组布局与下拉候选项，已忽略
  templates/default.json            GitHub 随代码发布的出厂默认模板
  templates/local-default.json      本机 General Description、附件路径与 Monitoring ID，已忽略
  templates/report-imported.json    本机 Report 当前值模板，已忽略
  report_schema.json                原始采集快照，已忽略
  run-logs.jsonl                    本机运行日志，已忽略
  screenshots/                      失败截图，已忽略
.runtime/
  credentials.json                  本机凭据，已忽略
  browser-profile/                  Playwright 登录态，已忽略
```

当原始 Report 采集快照更新后，重新生成 schema：

```powershell
npm run build:report-schema
```

## 安全与执行规则

- 每次仅操作一个 `Monitoring ID`。
- 自动化不会直接调用或重放 amfori 内部写接口，只通过真实网页填写和点击 Save。
- 找不到字段、模块或保存确认时，任务停止，不继续处理后续模块。
- 失败截图写入 `data/screenshots/`；操作日志写入 `data/run-logs.jsonl`。
- 不要提交 `.runtime/`、`local-default.json`、`report-imported.json`、原始采集快照、日志或截图。

## Report 验证顺序

1. 使用低风险项目，先勾选一个基础模块。
2. 分别验证文本、textarea、原生下拉、radio、checkbox、数字、时间和固定表格。
3. 单独验证一个动态 `ui-select` 搜索下拉。
4. 验证一个 PA 模块的复选与单选组合。
5. 验证两个模块连续执行。
6. 最后才选择全部 23 个模块。

完整的接手信息、技术路径和后续工作见 [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md)；环境搭建见 [SETUP.md](SETUP.md)。
