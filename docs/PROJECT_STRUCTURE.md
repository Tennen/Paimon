# Project Structure Reference

This document describes the current module layout and placement decisions.

## Doc Responsibilities

- `AGENTS.md`: hard constraints for coding agents (architecture boundaries, code rules, change safety).
- `README.md`: product capability, setup, and operator-facing usage.
- `docs/PROJECT_STRUCTURE.md` (this file): detailed module map and placement examples.

If these docs diverge, align them in the same change. For implementation constraints, `AGENTS.md` is authoritative.

## Current Structure

```text
src/
  config/          # Runtime config services/read-write helpers
  core/            # Orchestrator and runtime flow
    re-agent/      # /re sub-agent runtime (ReAct loop + module contracts)
  engines/         # Provider runtimes
    llm/           # LLM provider adapters (ollama/llama-server/openai/gemini/gpt-plugin/codex) + provider store/factory
    stt/           # STT provider adapters
  ingress/         # Inbound adapters (http/wecom/admin/notify/bridge)
  integrations/    # Outbound adapters and domain runtimes (flat by domain)
    codex/
    chatgpt-bridge/
    evolution-operator/
    homeassistant/
    market-analysis/
    md2img/
    mcp/
    multiagent/
    openai/
    rag/
    system-maintenance/
    terminal/
    topic-summary/
    writing-organizer/
    wecom/
  memory/          # Memory domain (session/raw/summary/index/compaction/hybrid retrieval)
  observable/      # Admin-defined menu/trigger config + callback event dispatch
  scheduler/       # Scheduler and push-user domain
  skills/          # Skill metadata manager only
  storage/         # Persistence abstraction (register/get/set)
  tools/           # LLM-callable tool handlers + schemas
```

Repo root:

```text
admin-web/         # Admin frontend
docs/              # Design/structure docs
skills/            # Skill packages (declarative SKILL.md only)
tools/             # Standalone scripts/binaries/helpers
data/              # Runtime data files
```

## Placement Rules (Quick)

- Inbound request translation only -> `src/ingress/`.
- Core orchestration/runtime loop -> `src/core/` (including `src/core/re-agent/`).
- Provider runtime implementation -> `src/engines/llm/` or `src/engines/stt/`.
- Third-party protocol/client adapters -> `src/integrations/<domain>/`.
- Shared codex execution/config/markdown-report adapters -> `src/integrations/codex/`.
- Markdown-to-image rendering pipeline -> `src/integrations/md2img/`.
- Other user-facing message/media adapters -> `src/integrations/user-message/` when the repo still needs them.
- System maintenance command runners for `/sync` `/build` `/restart` `/deploy` and admin repo operations -> `src/integrations/system-maintenance/`; build/deploy flows should install dependencies before `npm run build`.
- Domain runtime exceptions under integrations are allowed only for explicit runtime domains:
  - `evolution-operator`
  - `topic-summary`
  - `market-analysis`
  - `writing-organizer`
- Admin-defined external trigger/menu config + callback dispatch -> `src/observable/`.
- LLM-callable tools (schema + execute handler) -> `src/tools/`.
- Persistent state access -> `src/storage/persistence.ts` API only.
- Runtime config services -> `src/config/`.

## `/re` Runtime And Memory Routing

- `/re` runtime loop stays in `src/core/re-agent/`.
- All dialogue traffic appends to unified session memory and raw memory.
- Raw memory keeps original records; summary memory is derived and references raw ids/refs.
- Main orchestrator (`src/core/orchestrator.ts`) uses `HybridMemoryService` for planning context: summary vector retrieval first, raw replay by `rawRefs` second.
- If no summary hit is found, orchestrator falls back to session memory (`MemoryStore.read(sessionId)`).
- Retrieval is summary-first, with optional raw backfill by references.
- Keep `/re` command contract stable:
  - `/re <question>`
  - `/re help`
  - `/re reset`

## LLM Provider Selection

- Main flow provider selection is persisted in `src/storage/persistence.ts` store key `llm.providers`.
- `src/engines/llm/provider_store.ts` owns provider profiles and `default/routing/planning` selector ids.
- `src/core/orchestrator.ts` resolves LLM engine by step:
  - `routing` step can use a dedicated provider
  - `planning` step can use a dedicated provider
- Runtime domains `topic-summary` / `market-analysis` also persist provider selector fields (`summaryEngine` / `analysisEngine`) and should prefer explicit `provider-id` selections from the shared provider store.
- Admin API management entry points are in `src/ingress/admin.ts`:
  - `GET /admin/api/llm/providers`
  - `PUT /admin/api/llm/providers`
  - `POST /admin/api/llm/providers/default`
  - `DELETE /admin/api/llm/providers/:id`

## WeCom Menu Admin And Callback Routing

- WeCom transport is split across three entry points and should not be conflated:
  - `src/ingress/wecom.ts`: direct public callback ingress for WeCom HTTP/XML requests.
  - `src/ingress/wecomBridge.ts`: local bridge client that proactively connects to bridge SSE and uses active send APIs for outbound replies.
  - `tools/wecom-bridge.go` / `tools/wecom-bridge.js`: public bridge receiver/proxy that accepts external WeCom callbacks and exposes proxy endpoints such as `/stream` and `/proxy/*`.
- WeCom click-menu callbacks should enter core as raw event envelopes first. `EventKey -> dispatchText` resolution is centralized in `src/core/orchestrator.ts`, so `src/ingress/wecom.ts` and `src/ingress/wecomBridge.ts` stay transport-only.
- 企业微信菜单配置和事件日志保存在 `src/observable/menuService.ts`，持久化 key 为：
  - `observable.menu_config`
  - `observable.event_log`
- 企业微信菜单发布 API client 在 `src/integrations/wecom/menuClient.ts`，并通过 WeCom bridge 的 `/proxy/menu/create` 代理出口访问企业微信。
- `src/ingress/wecom.ts` 现在除文本/语音外，还负责接收 `MsgType=event` + `Event=click` 的企业微信菜单回调，并将 `EventKey` 转成内部可分发事件。
- Admin API 入口在 `src/ingress/admin.ts`：
  - `GET /admin/api/wecom/menu`
  - `PUT /admin/api/wecom/menu`
  - `POST /admin/api/wecom/menu/publish`

## Direct Input Mapping And `/ha` Direct Route

- 通用“固定文本 -> 目标输入”配置保存在 `src/config/directInputMappingService.ts`，持久化 key 为：
  - `direct-input.mappings`
- Orchestrator 在 `src/core/orchestrator.ts` 中会先对普通文本执行这层映射，再进入现有 direct shortcut / direct toolcall 流程。
- slash 命令本身不经过这层覆盖，避免 admin 配置拦截已有原生命令。
- Admin API 入口在 `src/ingress/admin.ts`：
  - `GET /admin/api/direct-input-mappings`
  - `PUT /admin/api/direct-input-mappings`
- Home Assistant 的 `/ha` direct toolcall 语法由 `src/tools/homeAssistantTool.ts` 注册，命令解析和真实执行在 `src/integrations/homeassistant/service.ts`。
- `friendly_name|entity_id -> entity/domain` 的解析由 `src/integrations/homeassistant/entityRegistry.ts` 负责，保持 vendor/runtime 细节留在 integration 层。

## Market Admin API Entry Points

- Market admin APIs are owned by `src/ingress/admin.ts` and must keep transport/input normalization concerns in ingress.
- Current market endpoints include:
  - `GET /admin/api/market/config`
  - `PUT /admin/api/market/config`
  - `GET /admin/api/market/securities/search`
  - `POST /admin/api/market/portfolio/import-codes`
  - `GET /admin/api/market/runs`
  - `POST /admin/api/market/run-once`

## Market Analysis Runtime Notes

- `src/integrations/market-analysis/` 现按能力分层：`fund/` 放基金分析主链路，`reporting/` 放 markdown 报告与图片输出 adapter，root 只保留命令入口、运行时编排、格式化与存储。
- 基金主流程 prompt 由 `src/integrations/market-analysis/fund/fund_prompt_builder.ts` 统一组装，结构尽量对齐股票分析侧“核心结论 / 数据视角 / 舆情情报 / 执行计划”的决策仪表盘架构，但基金指标改为收益、回撤、相对基准、跟踪偏离、申赎/基金经理事件等基金口径。
- `src/integrations/market-analysis/fund/fund_analysis_service.ts` 对单基金设置基础数据守卫：基金自身价格/净值序列抓取失败时，只保留 ingestion 审计与失败日志，直接跳过后续 feature/rule/LLM，避免把流程数据异常误判为高风险基金。
- 基金新闻检索由 `src/integrations/market-analysis/fund/search_adapter.ts` 负责；未配置 `SERPAPI_KEY` 时会标记 `serpapi:disabled_no_key` 并保持 fail-open。
- 全局搜索引擎 profile 存储在 `src/integrations/search-engine/store.ts`，持久化 key 为 `search.engines`（文件 `search-engines/profiles.json`）。
- `querySuffix` 这类业务关键词不放在全局 profile；基金场景在 `market.config.fund.newsQuerySuffix` 配置。
- Admin API 提供全局搜索引擎管理接口：`/admin/api/search-engines`、`/admin/api/search-engines/default`。
- 微信文本输出由 `src/integrations/market-analysis/formatters.ts` 负责（主要用于 `--no-llm` 等纯文本路径）；解释模式下由 `src/integrations/market-analysis/reporting/llm_report_adapter.ts` 组装基金分析 markdown 上下文，再调用 `src/integrations/codex/markdownReport.ts` 生成 LLM 报告，并通过 `src/integrations/md2img/` 的 unified + Playwright 渲染链路输出移动端图片。两条链路都应按“核心结论 / 数据视角 / 情报观察 / 执行计划”展开，并保持基金信号、评分、关键指标、数据完整性、新闻检索状态与组合摘要的一致性。
- markdown 图片渲染模块位于 `src/integrations/md2img/`，固定目录为 `markdown/`、`render/`、`styles/` + `index.ts`；其动态依赖安装与解析应以项目 package root 为准（不依赖进程启动 cwd）。

## Structural Change Checklist

1. Move directories/files.
2. Update imports (`rg` old paths).
3. Update docs together: `AGENTS.md`, `README.md`, and this file when relevant.
4. Run validation:
   - `npx tsc -p tsconfig.json`
   - `npm run test:evolution`
   - `npm run build` when admin API/admin-web is touched.
