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
- `src/core/`: 核心编排层，负责会话顺序、LLM 调度、工具执行流程；`src/core/re-agent/` 提供 `/re` 子 agent 的 ReAct 运行时
- `src/tools/`: 暴露给编排层和 LLM 的工具定义，例如 `homeassistant`、`terminal`
- `src/integrations/`: 外部系统适配层，封装 Home Assistant、企业微信、Topic Push、Market Analysis、Evolution Operator、RAG、MCP、Multi-agent 等集成
- `src/storage/`: 统一持久化入口，所有状态数据都通过这里读写
- `src/scheduler/`: 定时任务和推送用户管理
- `src/memory/`: 会话记忆存储（主对话记忆与 `/re` 子 agent 记忆分流）
- `src/skills/`: 技能元数据加载与管理
- `admin-web/`: 后台前端
- `tools/`: 独立脚本和桥接程序

### 请求处理流程

1. 输入先通过 `ingress` 层转成统一的 `Envelope`
2. `SessionManager` 保证同一会话按顺序处理
3. `Orchestrator` 决定是直接命令（含 `/re` 子 agent）、快捷指令，还是交给主 LLM 规划
4. `ToolRouter` 调用对应工具
5. 工具通过 `integrations` 访问外部系统
6. 结果写入记忆/审计/业务存储，并回传给调用方

这种结构的重点是：

- 输入协议和业务能力解耦
- 外部平台调用和 Agent 编排解耦
- 数据持久化集中管理，避免业务逻辑散落到文件路径上
- 新能力优先通过 `tool + integration` 的方式接入，而不是堆到入口层

## 当前已有能力

### 1. 多入口接入

- 企业微信文本消息接入
- 企业微信语音消息接入，支持 STT 转写后继续执行
- 通用 HTTP ingress
- Home Assistant 通知转发入口
- WeCom bridge SSE 模式，适合本地服务不方便公网暴露的场景

### 2. LLM 与智能体编排

- 支持 `Ollama`、`llama-server` 和 `OpenAI(ChatGPT API)`
- 支持技能发现、技能规划、工具调用的分步式执行
- 支持直接命令和异步回调型命令
- 支持会话记忆持久化
- 支持 `/re` 子 agent ReAct 循环（默认本地模型 `qwen3.5:9b`）

### 3. 工具与业务能力

- `homeassistant`: 查询设备状态、调用服务、抓取摄像头快照
- `terminal`: 执行本机命令
- `topic-push`: 从 RSS 源生成主题摘要，支持 profile/source 管理与去重状态
- `market-analysis`: A 股/ETF/基金分析、持仓管理、盘中/收盘分析结果沉淀
- `chatgpt-bridge`: 把请求转发到外部 ChatGPT bridge 运行时
- `evolution-operator`: 用于排队、执行、跟踪代码演化任务
- `re-agent modules`: 子 agent 可调用 `rag`、`mcp`、`multiagent` 三类模块
- `system shortcuts`: 内置 `/sync`、`/build`、`/restart`、`/deploy` 等运维捷径

### 4. 运维与后台能力

- Admin API 与 Admin Web 界面
- 模型配置查看与更新
- 定时任务和推送用户管理
- Topic Push 配置管理
- Market Analysis 配置与运行记录查看
- Evolution 队列与状态管理
- 审计日志与本地数据持久化

## 安装与部署

### 环境要求

最小要求：

- Node.js 18+

按场景可选：

- `Ollama`、`llama-server` 或 OpenAI API，作为 LLM provider
- `Python 3`，如果要启用 `fast-whisper` 语音转写
- `Home Assistant`，如果要启用智能家居能力
- 企业微信应用配置，若要通过 WeCom 收发消息
- 一台可公网访问的 VPS，若要使用 WeCom bridge 模式

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

项目启动时会读取根目录 `.env`。可参考仓库内的 `.env.example` 作为模板，下面保留最小可用配置示例。

#### 使用 Ollama

```env
PORT=3000

LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
OLLAMA_PLANNING_MODEL=qwen3:8b
RE_AGENT_MODEL=qwen3.5:9b
RE_AGENT_MAX_STEPS=6
RE_AGENT_TIMEOUT_MS=30000
MCP_ENDPOINT=
MCP_TIMEOUT_MS=15000

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

#### 启用企业微信

```env
WECOM_TOKEN=your_wecom_token
WECOM_CORP_ID=your_corp_id
WECOM_APP_SECRET=your_app_secret
WECOM_AGENT_ID=your_agent_id
```

#### 启用语音转写

```env
STT_PROVIDER=fast-whisper
STT_FAST_WHISPER_AUTO_INSTALL=true
STT_FAST_WHISPER_PYTHON=python3
STT_FAST_WHISPER_MODEL=small
```

如果只是先把服务跑起来，核心是先保证：

- 至少配置一个可用的 LLM Provider
- 若要启用 Home Assistant，再补 `HA_BASE_URL` 和 `HA_TOKEN`
- 若要启用企业微信，再补 `WECOM_*` 配置

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

这类模式适合家庭网络、本地开发机或 NAS 环境。

## `/re` 子 Agent 用法

- `/re <问题>`：触发子 agent 对话（ReAct 循环）
- `/re help`：查看子 agent 帮助
- `/re reset`：重置当前会话全局记忆（会清空主会话记忆与 raw/summary 双层记忆及其索引）
- 子 agent 输出统一以 `/re` 前缀返回，便于和主对话区分

Memory 规则（global hybrid memory）：

- 所有会话消息都会写入统一的 `MemoryStore` 会话记忆
- 所有会话消息都会完整写入 `raw memory`（不改写原文）
- 系统在低频触发 `compaction`（例如每 N 轮或任务结束）把未摘要批次提炼为结构化 `summary memory`
- `summary memory` 结构包含 `user_facts`、`environment`、`long_term_preferences`、`task_results` 与 `rawRefs`
- 运行时先做 `RAG` summary 混合检索（词法精确匹配 + 向量相似度融合排序），再按 `rawRefs` 按 ID 回补少量原文上下文
- `/re` 会在该全局记忆上执行子 agent 循环

## 数据与持久化

项目默认把运行数据写入 `data/` 目录，主要包括：

- 会话记忆（统一全局会话）
- 全局双层记忆数据文件：
  - `data/memory/raw.json`（raw memory）
  - `data/memory/summary.json`（summary memory）
  - `data/memory/summary-index.json`（summary 向量索引）
- 审计日志
- 定时任务和推送用户
- Topic Push 配置与状态
- Market Analysis 配置、持仓与运行记录
- Evolution 队列与指标

持久化统一走 `src/storage/persistence.ts`，业务模块不直接依赖具体文件路径。

## 扩展方式

如果你要继续扩展这个项目，推荐遵循下面的方式：

- 新的外部平台接入放到 `src/integrations/<domain>/`
- 新的 LLM 可调用工具放到 `src/tools/*Tool.ts`
- 新的输入协议放到 `src/ingress/`
- 新的技能只在 `skills/<name>/SKILL.md` 中声明契约，不把运行逻辑塞进技能目录

这也是当前项目保持可维护性的核心约束。

## 常用命令

```bash
npm run dev
npm run build
npm run test:evolution
npx tsc -p tsconfig.json
```

更多独立脚本可查看 [tools/README.md](tools/README.md)。
