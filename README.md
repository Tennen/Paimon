# Paimon

Paimon 是一个面向个人自动化和消息驱动场景的单进程 Agent Runtime。

它把来自企业微信、HTTP 或 Home Assistant 的输入统一转换成内部事件，再由 LLM 进行意图判断、技能规划和工具调用，最后把结果回传给用户或外部系统。项目目标不是做一个通用聊天壳，而是把“消息入口 + 本地模型 + 自动化工具 + 持久化 + 运维后台”收敛到一个可以长期运行的服务里。

## 项目是做什么的

这个项目主要用来搭建一个可持续运行的智能体服务，典型场景包括：

- 作为企业微信里的个人助理或自动化入口
- 作为 Home Assistant 的自然语言控制层
- 作为定时推送、RSS 主题摘要、市场分析的执行引擎
- 作为带后台管理界面的本地优先 Agent 服务
- 作为可扩展的技能运行时，后续可以继续接入更多工具或平台

## 核心架构

Paimon 采用单进程 monolith 结构，但内部职责分层明确：

```text
Ingress -> SessionManager -> Orchestrator -> ToolRouter -> Integrations -> Storage
                                   |
                                   +-> LLM Engine
                                   +-> Skill Manager
                                   +-> Memory / Scheduler / Admin
```

各目录职责如下：

- `src/ingress/`: 输入适配层，负责 HTTP、企业微信回调、SSE bridge、Admin API 等入口
- `src/core/`: 核心编排层，负责会话顺序、LLM 调度、工具执行流程；`src/core/conversation/` 承载主对话 runtime
- `src/tools/`: 暴露给编排层和 LLM 的工具定义，例如 `homeassistant`、`terminal`
- `src/integrations/`: 外部系统适配层，封装 Home Assistant、企业微信、Topic Summary、Market Analysis、Evolution Operator 等集成
- `src/observable/`: Admin 定义的菜单/触发器配置与回调事件分发
- `src/storage/`: 统一持久化入口，所有状态数据都通过这里读写
- `src/scheduler/`: 定时任务和推送用户管理
- `src/memory/`: 记忆域服务（session/raw/summary/index、compaction、hybrid 检索）
- `src/skills/`: 技能元数据加载与管理
- `admin-web/`: 后台前端
- `tools/`: 独立脚本和桥接程序

结构与放置规则的权威文档见 `docs/PROJECT_STRUCTURE.md`；实现约束见 `AGENTS.md`。

### 请求处理流程

1. 输入先通过 `ingress` 层转成统一的 `Envelope`
2. `SessionManager` 保证同一会话按顺序处理
3. `Orchestrator` 决定是直接命令、快捷指令，还是交给主 LLM 规划
4. `ToolRouter` 调用对应工具
5. 工具通过 `integrations` 访问外部系统
6. 结果写入记忆/审计/业务存储，并回传给调用方

这种结构的重点是：

- 输入协议和业务能力解耦
- 外部平台调用和 Agent 编排解耦
- 数据持久化集中管理，避免业务逻辑散落到文件路径上
- 新能力优先通过 `tool + integration` 的方式接入，而不是堆到入口层

### Admin Web 前端架构（Zustand）

当前 admin 前端采用“全局 store + section 自取状态”的结构：

- `admin-web/src/App.tsx`：仅负责页面布局、菜单切换、全局提示展示
- `admin-web/src/components/admin/hooks/store/`：按 domain 拆分 Zustand slice（system/messages/market/topic/writing/evolution 等）
- `admin-web/src/components/admin/hooks/use*SectionState.ts`：每个 section 的状态选择和动作绑定
- `admin-web/src/components/admin/*Section.tsx`：专注渲染与 UI 局部草稿状态，避免跨域状态编排

这样可以避免 `App.tsx` 大规模透传 props，也让各功能模块的状态边界更清晰。

## 当前已有能力

### 1. 多入口接入

- 企业微信文本消息接入
- 企业微信语音消息接入，支持 STT 转写后继续执行
- 企业微信 click 菜单事件接入（`EventKey` 回调）
- 通用 HTTP ingress
- Home Assistant 通知转发入口
- WeCom bridge SSE 模式，适合本地服务不方便公网暴露的场景

### 2. LLM 与智能体编排

- 支持 `Ollama`、`llama-server`、`OpenAI(ChatGPT API)`、`Gemini`、`gpt-plugin`、`codex-cli`
- 支持多 Provider Profile（多条 `openai-like` / `gemini-like` / `ollama` / `llama-server` / `codex`，单条 `gpt-plugin`），并可按场景独立选择
- 支持技能发现、技能规划、工具调用的分步式执行
- 主对话支持两套 runtime：
  - `classic`: 传统 `route -> planning -> tool/respond`
  - `windowed-agent`: 3 分钟短窗口内保留真实 `messages`，并用短租约 `skill lease` 继续多轮
- 支持直接命令和异步回调型命令
- 支持会话记忆持久化

### 3. 工具与业务能力

- `homeassistant`: 查询设备状态、调用服务、抓取摄像头快照，支持 `/ha ...` direct command
- `celestia`: 查询 AI 设备目录、执行语义命令或原始 action，支持 `/celestia ...` direct command
- `terminal`: 执行本机命令
- `topic-summary`: 从 RSS 源生成主题摘要，支持 profile/source 管理与去重状态
- `writing-organizer`: 材料整理流水线（`Material -> Insight -> Document`），支持增量采集、结构化提炼、版本化 Markdown 文档与回滚
- `market-analysis`: 基金分析、持仓管理、盘中/收盘分析结果沉淀
- `chatgpt-bridge`: 把请求转发到外部 ChatGPT bridge 运行时
- `evolution-operator`: 用于排队、执行、跟踪代码演化任务
- `system shortcuts`: 内置 `/sync`、`/build`、`/restart`、`/deploy` 等运维捷径
  - `/build` 会先执行 `npm install`，再执行 `npm run build`
  - `/deploy` 会执行同步代码 + `npm install` + `npm run build` + `pm2 restart 0`

### 4. 运维与后台能力

- Admin API 与 Admin Web 界面
- 模型配置查看与更新
- 主对话 runtime 切换（System -> 运行时）
- 对话 benchmark 页面，用于对比 `classic` / `windowed-agent` 的实际耗时
- 定时任务和推送用户管理
- Direct Input Mapping 配置（固定文本 -> 目标输入）
- 企业微信应用 click 菜单配置、发布与最近 `EventKey` 回调查看
- Topic Summary 配置管理
- Writing Organizer 主题列表/详情查看与整理操作
- Market Analysis 配置、持仓批量导入与运行记录查看
- Evolution 队列与状态管理
- 审计日志与本地数据持久化

## 安装与部署

### 环境要求

最小要求：

- Node.js 18+

按场景可选：

- `Ollama`、`llama-server`、OpenAI API 或 Codex CLI，作为 LLM provider
- `Python 3`，如果要启用 `fast-whisper` 语音转写
- `unified`、`remark-parse`、`remark-gfm`、`remark-rehype`、`rehype-stringify`、`playwright`，如果要启用 `/market` markdown 图片推送链路
- `Home Assistant`，如果要启用智能家居能力
- 企业微信应用配置，若要通过 WeCom 收发消息
- 一台可公网访问的 VPS，若要使用 WeCom bridge 模式

### 1. 安装依赖

```bash
npm install
```

默认情况下，`npm install` 会通过 `postinstall` 自动执行 `playwright install chromium`。

若你基于旧依赖版本升级、禁用了 install scripts，或需要手动修复浏览器依赖，可额外执行：

```bash
npm install unified remark-parse remark-gfm remark-rehype rehype-stringify playwright
npm run playwright:install
```

离线部署环境不会自动拉取缺失包或浏览器，需预装上述依赖和 Chromium 后再启动服务。

排障时可检查依赖是否被当前项目正确识别：

```bash
npm ls playwright unified remark-parse remark-gfm remark-rehype rehype-stringify
```

### 2. 配置环境变量

项目启动时会读取根目录 `.env`。可参考仓库内的 `.env.example` 作为模板，下面保留最小可用配置示例。

#### 持久化驱动（JSON / SQLite）

默认使用 JSON 文件存储。若要切换为 SQLite 主存储（`src/storage/persistence.ts` 驱动层），可配置：

```env
STORAGE_DRIVER=sqlite
STORAGE_SQLITE_PATH=data/storage/metadata.sqlite
```

当 `STORAGE_DRIVER=sqlite` 时，业务模块仍然通过 `registerStore/getStore/setStore/appendStore` 访问存储，不需要感知底层介质。

也可以在 Admin 后台 `System -> 运行时` 中直接修改 `STORAGE_DRIVER` / `STORAGE_SQLITE_PATH`（写入 `.env`，重启后完全生效）。

#### 使用 Ollama

```env
PORT=3000

LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
OLLAMA_PLANNING_MODEL=qwen3:8b

HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your_home_assistant_token
```

#### 使用 llama-server

```env
PORT=3000

LLM_PROVIDER=llama-server
LLAMA_SERVER_BASE_URL=http://127.0.0.1:8080
LLAMA_SERVER_MODEL=qwen3-thinking

HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your_home_assistant_token
```

#### 使用 OpenAI / ChatGPT API（可自动回落到 gptbridge）

```env
PORT=3000

LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
OPENAI_PLANNING_MODEL=gpt-4.1-mini
OPENAI_FALLBACK_TO_CHATGPT_BRIDGE=true
OPENAI_QUOTA_RESET_DAY=1
OPENAI_MONTHLY_TOKEN_LIMIT=
OPENAI_MONTHLY_BUDGET_USD=
OPENAI_COST_INPUT_PER_1M=
OPENAI_COST_OUTPUT_PER_1M=

HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your_home_assistant_token
```

说明：

- 当 API 返回 `insufficient_quota` / billing limit 时，系统会自动切到 `chatgpt-bridge`（若 `OPENAI_FALLBACK_TO_CHATGPT_BRIDGE=true`）。
- 可通过 Admin API 查看与管理额度状态：
  - `GET /admin/api/llm/openai/quota`
  - `POST /admin/api/llm/openai/quota`（`action=unblock|exhaust|reset`）

#### 使用 Gemini / Google GenAI API（gemini-like）

```env
PORT=3000

LLM_PROVIDER=gemini
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
GEMINI_PLANNING_MODEL=gemini-2.0-flash
```

#### 使用 Codex CLI（codex provider）

```env
PORT=3000

LLM_PROVIDER=codex
LLM_CODEX_MODEL=gpt-5-codex
LLM_CODEX_PLANNING_MODEL=gpt-5-codex
LLM_CODEX_REASONING_EFFORT=medium
LLM_CODEX_PLANNING_REASONING_EFFORT=high
LLM_CODEX_APPROVAL_POLICY=never
LLM_CODEX_SANDBOX=read-only
```

说明：

- `codex` provider 通过本地 `codex exec` 调用，运行机需要安装可执行命令 `codex`。
- 默认使用非交互审批策略（`never`）与 `read-only` sandbox，避免主流程路由/规划被审批提示阻塞。
- `reasoningEffort` 支持：`minimal | low | medium | high | xhigh`。

#### 多 Provider Profile（推荐）

- Provider Profile 使用 storage key `llm.providers` 持久化（`json-file` 驱动下对应 `data/llm/providers.json`）
- 支持创建多条 `openai-like` / `gemini-like` / `ollama` / `llama-server` / `codex` profile；`gpt-plugin` 仅允许一条
- 每条 profile 可配置对应 engine 的常用参数（baseUrl/model/planningModel/timeout/options 等）

可用 Admin API：

- `GET /admin/api/llm/providers`
- `PUT /admin/api/llm/providers`（创建/更新，body 可传 `provider`）
- `POST /admin/api/llm/providers/default`（可设置 `defaultProviderId` / `routingProviderId` / `planningProviderId`）
- `DELETE /admin/api/llm/providers/:id`

场景选择规则：

- 主编排（Orchestrator）支持独立配置 `routing` 与 `planning` provider（未单独设置时回退到 default）
- `topic-summary` 的 `summaryEngine` 推荐直接选择 `provider-id`（Admin 页面直接从 LLM provider 列表选择；`local/gpt_plugin` 仍兼容旧配置）
- `market-analysis` 的 `analysisEngine` 推荐直接选择 `provider-id`（Admin 页面直接从 LLM provider 列表选择；`local/gpt_plugin/gemini` 仍兼容旧配置，其中 `gemini` 为 legacy selector）

#### 启用企业微信

```env
WECOM_TOKEN=your_wecom_token
WECOM_CORP_ID=your_corp_id
WECOM_APP_SECRET=your_app_secret
WECOM_AGENT_ID=your_agent_id
```

启用后，Admin 可以额外管理企业微信应用的 click 菜单：

- `GET /admin/api/wecom/menu`
- `PUT /admin/api/wecom/menu`
- `POST /admin/api/wecom/menu/publish`

说明：

- 当前只支持 click 菜单（企业微信回调里体现为 `Event=click` + `EventKey`）
- Admin 里每个按钮都可以额外配置一段会送入 orchestrator 的命令或输入
- 当某个 `EventKey` 配置了这段命令/输入时，回调会把它送入现有会话处理链路（例如 `/market close`）
- 当该字段为空时，服务只记录该菜单事件，便于后续接真实 handler
- 菜单发布走 `WECOM_BRIDGE_URL` 对应的 WeCom bridge，不直接从 Paimon 本机请求 `menu/create`
- 如果企业微信应用启用了 IP 白名单，请把 bridge 部署在白名单允许的出口

#### Direct Input Mapping（Admin 可配文本改写）

可在 Admin 的“输入映射”页面配置一组固定文本规则，把普通输入直接改写成目标文本，再进入现有 orchestrator 处理链路。

对应 Admin API：

- `GET /admin/api/direct-input-mappings`
- `PUT /admin/api/direct-input-mappings`

说明：

- 规则支持两种匹配模式：
  - `exact`：标准化后完全相等
  - `fuzzy`：输入文本包含该片段
- 解析顺序为“先 exact，后 fuzzy；同模式下按列表顺序匹配”
- 只处理普通文本，不覆盖用户已经输入的 slash 命令
- 常见用法：
  - `盘中分析` -> `/market midday`
  - `看看门口` -> `/ha camera_snapshot camera.entryway`

#### Evolution 推送通知（可选）

```env
# evolution 专用收件人（优先级高于 WECOM_NOTIFY_TO）
EVOLUTION_NOTIFY_TO=

# 通用 WeCom 收件人（当 EVOLUTION_NOTIFY_TO 为空时回退）
WECOM_NOTIFY_TO=
```

说明：

- `EVOLUTION_NOTIFY_TO` 支持多个收件人，使用空格/逗号/分号/竖线分隔。
- 自动 tick 触发且命中可执行 Goal/Retry 时，会推送一条“自动 tick 已触发”通知。
- Goal 完成（成功/失败）后会推送一条完成通知。
- Goal 成功后若 `startedFromRef..push.commit` 存在新增提交，会额外推送一条简洁 git log 摘要（纯文本清洗、限制行数）。
- 通知发送失败只记录日志，不会中断 evolution 主流程。

#### 启用语音转写

```env
STT_PROVIDER=fast-whisper
STT_FAST_WHISPER_AUTO_INSTALL=true
STT_FAST_WHISPER_PYTHON=python3
STT_FAST_WHISPER_MODEL=small
```

说明：

- 启动时会自动检查并安装 `fast-whisper` 依赖。
- 当代理变量（`ALL_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`）使用 `socks*://` 时，会额外检查并安装 `httpx[socks]`（提供 `socksio`）。
- 若关闭 `STT_FAST_WHISPER_AUTO_INSTALL`，请手动安装上述 Python 依赖。

#### Home Assistant Direct Commands

除了 LLM 通过 `homeassistant` tool 调用外，也支持直接用 `/ha` 触发固定动作：

- `/ha call_service <service|domain.service> <friendly_name|entity_id>`
- `/ha camera_snapshot <friendly_name|entity_id>`
- `/ha get_state <friendly_name|entity_id>`

示例：

- `/ha call_service turn_on 客厅主灯`
- `/ha call_service light.turn_off light.bedroom_main`
- `/ha camera_snapshot 入户摄像头`

说明：

- `call_service` 默认会根据目标实体自动反推出 `domain`
- 若同名 `friendly_name` 对应多个实体，会返回歧义错误，避免误控设备
- `camera_snapshot` 会把 friendly name 解析为 `camera.*` 实体后抓图

#### Celestia Gateway

Celestia 集成通过 AI 设备 API 暴露智能家居设备目录与命令能力，需要配置：

```env
CELESTIA_BASE_URL=http://127.0.0.1:18080
CELESTIA_TOKEN=your_celestia_token
CELESTIA_DEVICE_REFRESH_MS=60000
```

LLM 可通过 `celestia` tool 读取 `tools_context.celestia.devices` 中的设备与命令目录；同时也支持直接命令：

- `/celestia list [query]`
- `/celestia call <device-or-room.command|command> | {"key":"value"}`
- `/celestia raw <device_id> <action> | {"key":"value"}`

示例：

- `/celestia list feeder`
- `/celestia call Kitchen Feeder.Feed Once | {"portions":2}`
- `/celestia raw petkit:feeder:pet-parent manual_feed_dual | {"amount1":20,"amount2":20}`

说明：

- `call` 走 Celestia 的语义解析能力，`target` 支持 `device-or-room.command`
- `raw` 会直接把 `device_id + action + params` 转发到 Celestia
- 当本地已加载设备目录时，`raw` 会先校验 `device_id` 是否存在，避免误发到未知设备

#### Market Analysis（基金主流程）

`/market` 当前仅支持基金分析主流程（标准化 -> 特征 -> 规则 -> LLM）：

- `/market <midday|close>`
- `/market fund <midday|close>`

基金流程会在数据层做分层降级：新闻与 LLM 失败默认不终止主流程，但若单只基金的基础行情/净值序列获取失败，则直接跳过该基金后续特征、规则与 LLM 分析，并在日志中记录基础数据接口错误；这种情况代表流程数据异常，不会被误判为基金高风险。输出仍统一为结构化决策仪表盘（`buy/add/hold/reduce/redeem/watch`）。基金 prompt 与报告结构会尽量贴近股票分析侧的“核心结论 / 数据视角 / 舆情情报 / 执行计划”四块架构，只是把股票指标替换为基金适用指标（收益、回撤、相对基准、跟踪偏离、申赎与基金经理事件等）。

`/market` 现在固定走 markdown 图片报告链路：要求 `analysisEngine` 实际 provider 为 `codex`，先组装基金分析 markdown 上下文，再交给 codex 生成最终报告，并通过 unified + Playwright 管线渲染移动端图片。

该链路为唯一模式，不再支持纯文本分析输出：

- `codex` markdown 生成失败、markdown 为空、或长图渲染失败，都会直接报错 `MARKET_IMAGE_PIPELINE_FAILED`
- 缺失依赖识别覆盖 `MODULE_NOT_FOUND`、ESM `ERR_MODULE_NOT_FOUND` 与 “Cannot find package/module” 消息；运行环境缺少 `playwright`、`unified` 或 remark/rehype 渲染依赖时会直接报错（不会发送纯文本兜底）
- 动态安装与模块解析以项目 package root 为准（不依赖任意启动 cwd）；排障可执行 `npm ls playwright unified remark-parse remark-gfm remark-rehype rehype-stringify`
- 企业微信图片发送必须走 WeCom bridge；直连 `/ingress/wecom` 通道会明确返回“当前通道不支持图片回复，请使用 WeCom bridge 通道。”

持仓字段说明（Admin 与持久化一致）：

- `code` 必填
- `name` 可选（推荐填写，或通过 admin 批量导入自动补全）
- `quantity` 可选
- `avgCost` 可选

当 `quantity/avgCost` 未填写时，分析流程会保留该持仓代码参与行情拉取，但不会把未填写字段注入解释 prompt。

Admin 批量导入代码接口：

```http
POST /admin/api/market/portfolio/import-codes
Content-Type: application/json

{
  "codes": "510300, 159915\n600519 000001"
}
```

接口会逐个查询证券名称并写入持仓持久化数据（已存在代码保留原数量/成本，仅更新名称）。

可选环境变量（示例）：

```env
ENABLE_FUND_ANALYSIS=true

# 新闻检索（基金事件/公告/经理变更）优先走全局 Search Engine Profiles
SERPAPI_KEY=
SERPAPI_ENDPOINT=https://serpapi.com/search.json
QIANFAN_SEARCH_API_KEY=
QIANFAN_SEARCH_ENDPOINT=https://qianfan.baidubce.com/v2/ai_search/web_search
QIANFAN_SEARCH_SOURCE=baidu_search_v2
QIANFAN_SEARCH_EDITION=standard
QIANFAN_SEARCH_TOP_K=10
QIANFAN_SEARCH_RECENCY_FILTER=month
QIANFAN_SEARCH_SAFE_SEARCH=false

# 基金分析默认跟随 market provider（可在 admin 的 Market Analysis 中直接选择 provider-id）
MARKET_ANALYSIS_FUND_LOCAL_MODEL=
# Market Analysis LLM timeout（最高优先级；codex 建议 >=60000）
MARKET_ANALYSIS_LLM_TIMEOUT_MS=60000
# legacy selector=gemini 的兼容项（推荐改为 provider-id）
MARKET_ANALYSIS_GEMINI_MODEL=gemini-2.0-flash
MARKET_ANALYSIS_GEMINI_TIMEOUT_MS=15000
```

`SERPAPI_KEY`、`QIANFAN_SEARCH_API_KEY` 和 `GEMINI_API_KEY` 建议通过 `.env` 配置（优先使用 System -> Search Engine Profiles / LLM Providers 统一管理）。

Market Analysis timeout 优先级：

- `MARKET_ANALYSIS_LLM_TIMEOUT_MS`
- LLM provider profile `config.timeoutMs`
- `LLM_TIMEOUT_MS`
- 内置默认值 `60000`

说明：

- 使用 codex 建议 `MARKET_ANALYSIS_LLM_TIMEOUT_MS>=60000`，避免常见 `codex timeout after 15000ms`。
- `fund.llmRetryMax` 在 Admin 的 `Market Analysis` 配置中维护，值越大总执行时长越长，近似为 `(llmRetryMax + 1) * timeoutMs`。

当所选 Search Engine 未配置可用密钥、已禁用或请求失败时，基金流程不会中断；会在审计链路中记录 `search_status:*` 与 provider/source 信息，并继续走回退新闻源（若已配置 `MARKET_ANALYSIS_NEWS_API`）。

Admin 侧新增全局 `Search Engine Profiles`（System 模块）：

- 支持维护多套 Search Engine 配置，当前支持：
- `serpapi`: `id/name/enabled/endpoint/apiKey/engine/hl/gl/num`
- `qianfan`: `id/name/enabled/endpoint/apiKey/searchSource/edition/topK/recencyFilter/safeSearch`
- `Market Analysis` 配置中可选择 `News Search Engine`，并单独配置业务侧 `fund.newsQuerySuffix`
- Search Engine runtime 位于 `src/integrations/search-engine/`；`market-analysis` 只负责基金检索词规划与回退源，不再感知具体 provider 协议
- 默认 profile 持久化在 `search-engines/profiles.json`

相关接口：

- `GET /admin/api/search-engines`
- `PUT /admin/api/search-engines`
- `POST /admin/api/search-engines/default`
- `DELETE /admin/api/search-engines/:id`

如果只是先把服务跑起来，核心是先保证：

- 至少配置一个可用的 LLM Provider
- 若要启用 Home Assistant，再补 `HA_BASE_URL` 和 `HA_TOKEN`
- 若要启用 Celestia，再补 `CELESTIA_BASE_URL` 和 `CELESTIA_TOKEN`
- 若要启用企业微信，再补 `WECOM_*` 配置

#### Memory 检索与压缩（可选）

```env
LLM_MEMORY_CONTEXT_ENABLED=true
MEMORY_COMPACT_EVERY_ROUNDS=4
MEMORY_COMPACT_MAX_BATCH_SIZE=8
MEMORY_SUMMARY_TOP_K=4
MEMORY_RAW_REF_LIMIT=8
MEMORY_RAW_RECORD_LIMIT=3
```

说明：

- `LLM_MEMORY_CONTEXT_ENABLED`：是否在主对话 routing/planning 阶段检索 memory 并注入 prompt（默认 `true`）
- `MEMORY_COMPACT_EVERY_ROUNDS`：触发一次 summary compact 的最小 raw 轮次阈值
- `MEMORY_COMPACT_MAX_BATCH_SIZE`：单次 compact 最大处理 raw 条数
- `MEMORY_SUMMARY_TOP_K`：主 orchestrator 的 summary 命中条数上限
- `MEMORY_RAW_REF_LIMIT`：summary 命中后允许回补的 rawRefs 数量上限
- `MEMORY_RAW_RECORD_LIMIT`：最终注入上下文的 raw 回放条数上限

#### 主对话运行时（可选）

```env
MAIN_CONVERSATION_MODE=classic
CONVERSATION_WINDOW_TIMEOUT_SECONDS=180
CONVERSATION_WINDOW_MAX_TURNS=6
CONVERSATION_AGENT_MAX_STEPS=4
```

说明：

- `MAIN_CONVERSATION_MODE`：主对话默认 runtime，`classic` 为旧的 `route -> planning` 链路，`windowed-agent` 为消息窗口 runtime
- `CONVERSATION_WINDOW_TIMEOUT_SECONDS`：用户在收到回复后，下一条消息仍算同一个短窗口的超时时间
- `CONVERSATION_WINDOW_MAX_TURNS`：短窗口最多保留多少轮真实 `user/assistant` 消息
- `CONVERSATION_AGENT_MAX_STEPS`：`windowed-agent` 单轮内允许的最大 agent/tool 推理步数
- Admin `System -> 运行时` 里可以单独勾选哪些 `skills` 允许进入 routing 第一步的 `skills_context`
- 同一页面也可以单独勾选哪些 `tools` 允许进入 skill planning 阶段的 `tools_context` / `_tools.schema`
- 这些值也可以在 Admin `System -> 运行时` 页面修改；对话性能对比可在 Admin `对话 Benchmark` 页面执行

### 3. 本地开发启动

```bash
npm run dev
```

启动后可使用：

- `http://localhost:3000/health` 查看服务存活
- `http://localhost:3000/admin` 打开管理后台

如果需要单独调试后台前端：

```bash
npm run dev:admin
```

### 4. 生产构建与运行

```bash
npm run build
npm start
```

说明：

- `npm run build` 会同时构建后端和 `admin-web`
- 生产模式下，后台页面由主服务统一托管在 `/admin`
- 建议使用 `systemd`、`pm2` 或容器方式托管进程
- 建议在前面加一层 Nginx 或其他反向代理

### 5. 企业微信部署方式

如果你的服务可以直接暴露公网，可以直接把企业微信回调配置到 Paimon 服务。

如果服务运行在本地网络里，不方便开放公网入口，可以使用仓库内的 WeCom bridge：

- 在公网机器上部署 `tools/wecom-bridge.go` 或 `tools/wecom-bridge.js`
- 本地 Paimon 通过 `WECOM_BRIDGE_URL` 主动连接 bridge 的 SSE 流
- 这样企业微信请求先到 bridge，再由 bridge 转发给本地 Agent
- 包含图片的响应（如 `/market` 图片报告）仅支持 bridge 发送；直连回调通道不会降级为纯文本图片说明

这类模式适合家庭网络、本地开发机或 NAS 环境。

补充：

- 菜单发布同样复用 WeCom bridge 的代理能力，因此企业微信有 IP 限制时，Admin 发布菜单也应经过 bridge

## Hybrid Memory 规则

- 所有会话消息都会写入统一的 `MemoryStore` 会话记忆
- 所有会话消息都会完整写入 `raw memory`（不改写原文）
- 系统在低频触发 `compaction`（例如每 N 轮或任务结束）把未摘要批次提炼为结构化 `summary memory`
- `summary memory` 结构包含 `user_facts`、`environment`、`long_term_preferences`、`task_results` 与 `rawRefs`
- 主 `Orchestrator` 已接入 `HybridMemoryService`：先做 `SummaryVectorIndex.search`（词法精确匹配 + 向量相似度融合排序），再按 `rawRefs` 通过 `RawMemoryStore.getByIds` 回补少量原文上下文
- 当 summary 检索无命中时，主 `Orchestrator` 会回退到 `MemoryStore.read(sessionId)` 的会话记忆
- `windowed-agent` 的短窗口对话历史单独保存在 `conversation window` store 中，只保留最近真实消息与可续租 skill；它不替代长期 hybrid memory

## Incremental Writing Organizer

写作整理能力使用 `/writing` 直达命令，默认按 `Material -> Insight -> Document` 流程运行。

每个 topic 的数据位于 `data/writing/topics/<topic-id>/`，结构如下：

- `raw/*.md`：原始片段，rolling 存储（单文件最多 200 行）
- `state/{summary,outline,draft}.md`：当前版本
- `backup/*.prev.md`：上一版备份
- `meta.json`：topic 元信息（用于命令与 admin 查询）
- `knowledge/materials/<YYYY>/<MM>/mat_*.json`：Material 原始与清洗文本
- `knowledge/insights/<YYYY>/<MM>/ins_*.json`：Insight 结构化提炼结果
- `knowledge/documents/<YYYY>/<MM>/doc_*_vNNN_<mode>.md`：版本化 Document
- `knowledge/documents/<YYYY>/<MM>/doc_*_vNNN_<mode>.meta.json`：Document metadata（`material_ids`、`version`、`path` 等）

默认 `summarize` 会生成 `knowledge_entry` 模式文档；topic 标题包含 `article/memo/research` 关键词时会自动切换到对应模式。

常用命令：

- `/writing topics`
- `/writing show <topic-id>`
- `/writing append <topic-id> "一段新内容"`
- `/writing summarize <topic-id> [--mode knowledge_entry|article|memo|research_note]`
- `/writing restore <topic-id>`
- `/writing set <topic-id> <summary|outline|draft> "内容"`（手动整理）

## 数据与持久化

项目默认把运行数据写入 `data/` 目录，主要包括：

- 会话记忆（统一全局会话）
- 全局双层记忆数据（`json-file` 驱动下对应文件）：
  - `data/memory/raw.json`（raw memory）
  - `data/memory/summary.json`（summary memory）
  - `data/memory/summary-index.json`（summary 向量索引）
  - `data/memory/conversation-windows.json`（主对话短窗口状态）
- 审计日志
- 定时任务和推送用户
- Topic Summary 配置与状态
- Incremental Writing Organizer 主题目录、raw/state/backup、knowledge artifacts 与 meta
- Market Analysis 配置、持仓与运行记录
- Evolution 队列与指标

持久化统一走 `src/storage/persistence.ts`，业务模块不直接依赖具体文件路径。

## SQLite 部署（Persistence 主存储）

如果你要把当前 JSON 持久化数据迁移到 SQLite（覆盖 `DATA_STORE` 下所有 store），使用：

```bash
npx tsx tools/migrate_persistence_to_sqlite.ts --strict
```

可选参数：

- `--db <path>`：指定 SQLite 文件路径
- `--stores a,b`：只迁移指定 store（值需来自 `DATA_STORE`）
- `--list`：列出全部 store 定义

迁移完成后，在 `.env` 设置：

```env
STORAGE_DRIVER=sqlite
STORAGE_SQLITE_PATH=data/storage/metadata.sqlite
```

重启服务即可切换到 SQLite 驱动。

## SQLite 索引部署（Writing Organizer Knowledge，可选）

Writing Organizer 默认使用 JSON + Markdown 持久化。若要提升检索与统计效率，可额外部署 SQLite 元数据索引。

### 1. 环境准备

- Python 3.9+（需自带 `sqlite3` 标准库）
- 可选：`sqlite3` CLI（用于手工验证）

### 2. 构建 SQLite 索引

```bash
python3 tools/migrate_writing_knowledge_to_sqlite.py \
  --topics-root data/writing/topics \
  --db data/writing/index/metadata.sqlite
```

脚本会扫描 `knowledge/materials|insights|documents`，重建三张主表：

- `materials`
- `insights`
- `documents`

并在可用时自动重建 FTS 表（`materials_fts`、`documents_fts`）。

### 3. 验证索引

```bash
sqlite3 data/writing/index/metadata.sqlite \"SELECT count(*) FROM materials;\"
sqlite3 data/writing/index/metadata.sqlite \"SELECT count(*) FROM insights;\"
sqlite3 data/writing/index/metadata.sqlite \"SELECT count(*) FROM documents;\"
```

### 4. 定时同步（建议）

可通过 cron/systemd 定时执行上面的迁移脚本，把 JSON/Markdown 的最新内容同步到 SQLite 索引层。

## 扩展方式

如果你要继续扩展这个项目，推荐遵循下面的方式：

- 新的外部平台接入放到 `src/integrations/<domain>/`
- 新的 LLM 可调用工具放到 `src/tools/*Tool.ts`
- 新的输入协议放到 `src/ingress/`
- 新的技能只在 `skills/<name>/SKILL.md` 中声明契约，不把运行逻辑塞进技能目录
- admin-web 侧新增能力时，优先按 `hooks/store slice -> use*SectionState -> Section` 的分层扩展，而不是把状态编排回推到 `App.tsx`

结构相关细则统一以 `docs/PROJECT_STRUCTURE.md` 为准。

这也是当前项目保持可维护性的核心约束。

## 常用命令

```bash
npm run dev
npm run build
npm run test:evolution
node --test --import tsx src/integrations/market-analysis/image_pipeline.test.ts src/integrations/wecom/sender.test.ts
npx tsc -p tsconfig.json
```

更多独立脚本可查看 [tools/README.md](tools/README.md)。
