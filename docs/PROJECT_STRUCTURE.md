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
    mcp/
    multiagent/
    openai/
    rag/
    system-maintenance/
    terminal/
    topic-summary/
    user-message/
    writing-organizer/
    wecom/
  memory/          # Memory domain (session/raw/summary/index/compaction/hybrid retrieval)
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
- User-facing message/media adapters (markdown-to-image, response media shaping) -> `src/integrations/user-message/`.
- Domain runtime exceptions under integrations are allowed only for explicit runtime domains:
  - `evolution-operator`
  - `topic-summary`
  - `market-analysis`
  - `writing-organizer`
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

- 基金主流程 prompt 由 `src/integrations/market-analysis/fund_prompt_builder.ts` 统一组装（基础信息/行情摘要/特征/规则/新闻状态/schema 约束）。
- 基金新闻检索由 `src/integrations/market-analysis/search_adapter.ts` 负责；未配置 `SERPAPI_KEY` 时会标记 `serpapi:disabled_no_key` 并保持 fail-open。
- 全局搜索引擎 profile 存储在 `src/integrations/search-engine/store.ts`，持久化 key 为 `search.engines`（文件 `search-engines/profiles.json`）。
- `querySuffix` 这类业务关键词不放在全局 profile；基金场景在 `market.config.fund.newsQuerySuffix` 配置。
- Admin API 提供全局搜索引擎管理接口：`/admin/api/search-engines`、`/admin/api/search-engines/default`。
- 微信文本输出由 `src/integrations/market-analysis/formatters.ts` 负责（主要用于 `--no-llm` 等纯文本路径）；解释模式下由 `src/integrations/market-analysis/codex_markdown_report.ts` 组装 markdown 上下文并生成长图，需覆盖旧链路关键字段（动作、评分、关键指标、数据完整性、新闻检索状态、组合摘要）。
- markdown 长图渲染适配器位于 `src/integrations/user-message/markdownImageAdapter.ts`，由各业务集成按需调用（例如 market/topic-summary）；其动态依赖安装与解析应以项目 package root 为准（不依赖进程启动 cwd）。

## Structural Change Checklist

1. Move directories/files.
2. Update imports (`rg` old paths).
3. Update docs together: `AGENTS.md`, `README.md`, and this file when relevant.
4. Run validation:
   - `npx tsc -p tsconfig.json`
   - `npm run test:evolution`
   - `npm run build` when admin API/admin-web is touched.
