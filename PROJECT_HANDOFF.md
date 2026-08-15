# AutoForm 项目交接说明

## 项目目标与范围

AutoForm 是个人 Windows 电脑本地运行的 amfori 自动填表工具。工具只处理以下三个模块：

- `General Description`
- `Report`
- `Report Attachments`

不处理 `Details`、`Closing Meeting`、`Previous Monitorings` 或其他 amfori 页面模块。每次任务只处理一个 `Monitoring ID`。

## 当前进度

已完成并在真实项目中验证：

- `General Description` 中的文本字段填写、保存成功提示检测和刷新后持久化校验。
- `Report Attachments` 的独立文件加载、用户确认、上传和保存流程。
- 账号密码本地保存、Playwright 持久化浏览器登录态复用。
- 保存按钮被聊天浮层遮挡时的处理：精确定位页面 Save、临时隐藏聊天组件并在必要时强制点击。
- 表单填写与附件上传已拆分为独立任务；附件上传不会覆盖文本表单内容。

已实现，尚待真实项目分批验证：

- 已将 Report 采集结果拆分为 23 个模块 schema，当前包含 1,302 个可编辑字段；导航、只读和焦点辅助控件已排除。
- 本地 Report 编辑器按模块懒加载，支持文本、多行文本、数字、时间、原生下拉、单选、复选、自定义下拉和固定表格。
- Report 任务可选择单个、多个或全部模块；每个模块独立 Save、刷新并校验，失败后日志会记录已完成模块。
- 仍须先在低风险项目上验证各控件类型，尤其是 90 个 `ui-select` 搜索下拉和复杂 PA 复选组合；未完成验证前不要一次执行全部 23 个模块。

## 技术路径

- 前端：原生 HTML、CSS、JavaScript。
- 本地服务：Node.js 内置 HTTP 服务，默认地址 `http://127.0.0.1:3000`。
- 网页自动化：Playwright 的持久化 Chromium context。
- 配置与模板：JSON。
- 运行日志：JSONL。
- 运行方式：仅本机使用，不部署线上，不使用 Python 或数据库。

## 文件架构

```text
AutoForm/
├── public/                       本地操作页面
│   ├── index.html                左侧业务表单和右侧控制器布局
│   ├── app.js                    模板、登录信息、表单任务和附件任务交互
│   └── styles.css                页面样式
├── src/
│   ├── server.js                 本地 HTTP 服务和 API 路由
│   ├── storage.js                JSON、JSONL 和本地文件操作
│   ├── reportStorage.js          Report schema、模块和模板读写
│   └── automation/amforiBot.js   Playwright 登录、填表、上传和保存确认
├── config/
│   ├── settings.json             平台地址、超时和浏览器 profile 配置
│   └── field-mapping.json        模块 tab、字段 selector 和 Save selector
├── data/
│   ├── templates/default.json    默认业务模板
│   ├── report-schema/            可提交的无值 Report schema，按模块拆分
│   ├── templates/report-imported.json  本机当前值 Report 模板，忽略
│   ├── report_schema.json        原始采集快照，本机来源文件，忽略
│   ├── run-logs.jsonl            运行日志，本地生成且忽略
│   └── screenshots/              失败截图，本地生成且忽略
├── scripts/build-report-schema.mjs  从原始采集快照生成模块 schema 与本机模板
├── .runtime/                     账号密码和浏览器登录态，本地生成且忽略
├── Start-AutoForm.cmd            一键启动脚本
└── AutoForm.lnk                  启动快捷方式
```

## 当前工作流

### 登录与本地数据

控制器中的“保存本地登录信息”将账号密码写入 `.runtime/credentials.json`。Playwright 浏览器 profile 位于 `.runtime/browser-profile`。

执行任务时优先复用持久化登录态；登录态失效时，自动使用本机保存的账号密码登录。运行数据不应进入 Git、文档或日志。

### 表单填写任务

右侧控制器输入 `Monitoring ID` 后点击“开始执行”。该任务只填写 `General Description` 中本地有内容的字段。

- 空字段跳过，不覆盖线上内容。
- 非空字段会覆盖线上内容，执行前显示确认提示。
- 仅在实际填入内容后点击 Save。
- Save 成功后检测页面成功消息，并刷新验证已填写字段。

### Report 模板与执行

本地页面的 Report 工作区按原网页的 23 个模块顺序显示。点击模块名称才加载该模块控件，勾选框只决定哪些模块会执行。

- “保存 Report 模板”只写入本机 `data/templates/report-imported.json`。
- “执行已选 Report 模块”会先从 Monitoring ID 打开当前项目，再动态进入真实 Report 页，不复用采集时的绝对 URL。
- 每个模块只写入本地模板中有值的字段；每个模块独立保存、刷新、校验后再处理下一个。
- 失败时立即停止；JSONL 日志会保留已完成模块、失败原因与截图路径，重新选择失败模块即可续跑。

### Report 结构对齐状态

当前 schema 已从目标页只读采集并重建：23 个模块的章节/分组/折叠面板/帮助文字/单选复选选项组/固定表格布局，以及 90 个 `ui-select` 动态下拉的候选项（按内容去重为 20 组来源，全部为完整固定列表）。字段集不变性校验通过（23 模块、1,302 个可编辑字段，key/selector/type/uiSelectIndex 与原始快照一致）。

表格内控件绑定已修复：无唯一 id 的 `ui-select` 不再只按 `cell.id` 关联。采集器对表格单元格按 DOM 顺序记录 `uiSelectIndex`（或字段 id），并结合表格行列坐标绑定回原单元格；同时识别 `form-field-type-selectcurrency`（ui-select 或原生下拉）与 `form-field-type-selectboxes`（多选框组）等容器类型。重建后兜底追加区为空——1,302 个字段全部映射到布局，无未映射字段。已核对 Monitoring Details、Sampled Workers（5×14 多行表格）、PA-7 三个代表模块，并用无头浏览器实测本地渲染（表格内 Role/Gender 等 ui-select 渲染为原行列的下拉控件、复选框组渲染为选项组）。

结构对齐是语义结构一致，不是目标网页的逐像素复制。仍未完成：

- 人工对照目标页核验各模块的章节顺序、选项组归属、固定表格表头与行数是否对应（结构绑定已程序化校验，尚未逐屏截图与目标页并排核对）。
- 90 个 `ui-select` 候选项均已标 `complete`；若后续发现个别下拉实为远程搜索型，应改为 `partial` 并保留本地搜索框（当前采集结果全部为静态完整列表，未见远程搜索型）。
- 真实项目分批自动化验证（见「接手步骤」）。

不要通过复制目标网站 HTML、CSS 或项目专属 URL 来实现结构对齐。应保存通用的模块、分组、表格、字段和选项元数据，并在真实网页中动态定位当前项目。

### 附件上传任务

左侧 `Report Attachments` 模块填写文件夹路径，先点击“加载附件文件”查看文件名。确认后点击“确认仅上传附件”。

- 仅上传确认时显示的文件名。
- 修改文件夹路径或 `Monitoring ID` 后必须重新加载。
- 此任务只操作 `Report Attachments`，不会填写或覆盖文本字段。
- 上传后点击 Save 并等待保存确认。

## 接手步骤

1. （布局与选项采集已完成）如需重新采集，运行 `node scrape_report_layout.mjs` 与 `node scrape_report_options.mjs`（均支持断点续跑，产物在 `data/report-layout/`，已忽略）。
2. 运行 `npm run build:report-schema` 重建 schema，再 `node scripts/validate-report-schema.mjs` 确认字段集不变性（应显示 23 模块、1,302 字段）。
3. 人工对照目标页核验各模块章节/选项组/表格结构对应，再 `npm start` 打开 http://127.0.0.1:3000 抽查本地渲染。
4. 在低风险项目选择一个模块，分别验证文本、下拉、单选、复选、时间和表格字段。
5. 单独验证一个自定义 `ui-select` 搜索下拉；若其候选项 DOM 与当前统一适配器不符，只调整该适配器，不要写死项目 URL。
6. 再按基础信息、表格模块、PA 模块的顺序进行单模块测试，最后才测试多个模块连续运行。
7. 若平台改版，重新采集原始 schema 并运行生成脚本；不要手改浏览器 profile、凭据或本地导入值模板。

## 本地运行与检查

```powershell
npm start
npm run check
npm run validate:config
```

浏览器访问 `http://127.0.0.1:3000`。也可以通过根目录 `AutoForm.lnk` 启动。

## 注意事项

- `.runtime/credentials.json` 含本地登录凭据；密码输入框的星号仅是界面遮掩。
- `.runtime/browser-profile` 是 Playwright 登录态，删除后需要重新登录。
- 失败时优先查看 `data/run-logs.jsonl` 和 `data/screenshots/`。
- 当前附件上传控件依赖标准 `input[type='file']`；平台改变上传组件时需要单独适配。
