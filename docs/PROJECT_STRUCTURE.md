# Project Structure Reference

This document is the canonical source for module placement and structural boundaries in this repository.

## Doc Responsibilities

- `AGENTS.md`: coding constraints and safety rules for implementation.
- `README.md`: product capability, setup, operator usage.
- `docs/PROJECT_STRUCTURE.md` (this file): authoritative structure map, placement rules, and refactor boundaries.

If structure-related guidance conflicts between docs, follow this file and then sync `AGENTS.md`/`README.md` in the same change.

## Current Structure Snapshot

```text
src/
  config/          # Runtime config services/read-write helpers
  core/            # Orchestrator and runtime flow
    conversation/  # Main conversation runtimes (classic/windowed-agent), shared helpers, benchmark
  engines/         # Provider runtimes
    llm/           # LLM provider adapters + provider store/factory
    stt/           # STT provider adapters
  ingress/         # Inbound adapters (http/wecom/admin/notify/bridge)
  integrations/    # Outbound adapters and domain runtimes
    celestia/
    codex/
    chatgpt-bridge/
    evolution-operator/
    homeassistant/
    market-analysis/
    md2img/
    openai/
    search-engine/
    system-maintenance/
    terminal/
    topic-summary/
    writing-organizer/
    wecom/
  memory/          # Memory domain
  observable/      # Admin-defined menu/trigger config + callback dispatch
  scheduler/       # Scheduler and push-user domain
  skills/          # Skill metadata manager only
  storage/         # Persistence abstraction (register/get/set)
  tools/           # LLM-callable tool handlers + schemas
```

Repo root:

```text
admin-web/
  src/
    App.tsx                    # Layout/menu shell only (no cross-domain state orchestration)
    components/admin/          # Section components (view + UI-local draft state)
      hooks/
        useAdminStore.ts       # Zustand store entry
        useAdminBootstrap.ts   # Bootstrap/polling lifecycle
        use*SectionState.ts    # Section-level state selectors/actions
        store/                 # Zustand slices by stable domain responsibility
docs/
skills/
tools/
data/
```

## Canonical Placement And Boundary Rules

### Backend Boundaries

- `src/ingress/`
  - Transport adapters only (HTTP, WeCom callback, bridge stream, admin routes).
  - Parse/validate external input and translate to internal envelope/service calls.
  - No vendor API client logic.
  - WeCom split is explicit and fixed:
    - `src/ingress/wecom.ts`: direct public WeCom callback ingress (HTTP/XML callback + sync callback reply).
    - `src/ingress/wecomBridge.ts`: local bridge client (connects to `WECOM_BRIDGE_URL` SSE, consumes bridge payloads, sends outbound replies via `src/integrations/wecom/sender.ts`).
    - `tools/wecom-bridge.go` / `tools/wecom-bridge.js`: public bridge receiver/proxy.
  - `EventKey -> dispatchText` resolution belongs to core orchestration (`src/core/orchestrator.ts`), not ingress.

- `src/core/`
  - Orchestration and tool routing only.
  - No direct filesystem persistence and no vendor-specific API code.
  - Main conversation runtime stays split in `src/core/conversation/` by stable responsibility (`shared`, `classic`, `agent`, `benchmark`, `types`).
  - Do not collapse multi-mode runtime back into one catch-all orchestrator module.

- `src/config/`
  - Runtime configuration readers/writers and config services only.
  - No business orchestration.

- `src/engines/llm/`
  - Provider runtime adapters only (`ollama`, `llama-server`, `openai`, `gemini`, `gpt-plugin`, `codex`, etc.).
  - Keep unified `LLMEngine` contract.
  - No skill/business workflow branching.
  - Provider-specific quota/account state belongs in `src/integrations/<provider>/` + `src/storage/`.

- `src/engines/stt/`
  - STT provider runtime adapters only.
  - Provider selection/retry/timeout behavior lives here, not in ingress/core.

- `src/integrations/`
  - External system adapters and domain runtime modules.
  - Encapsulate HTTP/WebSocket/protocol details.
  - Default rule: no cross-domain orchestration/business workflow state.
  - Shared codex execution/config/report helpers belong in `src/integrations/codex/`.
  - Markdown-to-image runtime belongs in `src/integrations/md2img/`.
  - Other user-facing message/media adapters belong in `src/integrations/user-message/` when needed.
  - Runtime-domain exceptions (explicitly allowed):
    - `src/integrations/evolution-operator/`
    - `src/integrations/topic-summary/`
    - `src/integrations/market-analysis/`
    - `src/integrations/writing-organizer/`
  - Prefer flat domain roots (`src/integrations/<domain>/`), no `integrations/tools` layer.
  - Flatness limit: when one domain directory grows beyond 10 files, or files clearly split into different abstraction layers/capability groups, split into subdirectories by stable responsibility.

- `src/tools/`
  - Independent LLM-callable tool definitions.
  - Register schemas/handlers and call integrations.
  - No skill-specific orchestration logic or persistence policy.

- `src/storage/`
  - Single persistence gateway.
  - Use `registerStore`, `getStore`, `setStore`.
  - Business modules must not depend on file paths.

- `src/observable/`
  - Admin-defined trigger/menu config and callback-event dispatch only.
  - No vendor HTTP/API client code (WeCom API access stays in `src/integrations/wecom/`).
  - No ingress parsing.
  - `menuService.ts` is the entrypoint; split menu normalization/store/publish helpers under `src/observable/menu/` when needed.

- `src/scheduler/`, `src/memory/`
  - Domain services and state management.
  - Persistence access only through `src/storage/persistence.ts`.

### Admin-Web Boundaries

- `admin-web/` is UI-only.
- Must consume backend contracts from shared type definitions in `admin-web/src/types/admin.ts`.
- `admin-web/src/App.tsx` is layout/menu shell only.
- Global page/admin domain state is centralized in Zustand slices under `admin-web/src/components/admin/hooks/store/`.
- Section state binding should be implemented in section hooks (`use*SectionState.ts`) under `admin-web/src/components/admin/hooks/`.
- Section components should focus on rendering and UI-local draft state; avoid cross-domain orchestration inside sections.

## Directory Evolution Rules

- New external platform clients -> `src/integrations/<platform>/`.
- New integration modules stay under `src/integrations/<domain>/`.
- New independent LLM-callable tools -> `src/tools/`.
- Standalone operational scripts -> repo root `tools/` (not `src/`).
- New cross-cutting infrastructure modules -> `src/<infra-domain>/` and reusable by multiple domains.
- Any source/admin-web/tool/test/doc file beyond 500 lines must be split by stable responsibility. Do not keep extending oversized files.
- When a runtime introduces multiple phases/modes, create a dedicated subdirectory and split by stable role (`types.ts`, `shared.ts`, `runtime.ts`, services).
- If a module mixes state machine logic, prompt construction, persistence coordination, and admin contracts, split before adding more behavior.

## Memory Routing

- All dialogue traffic appends to unified session memory and raw memory.
- Raw memory keeps original records; summary memory is derived and references raw ids/refs.
- Main orchestrator (`src/core/orchestrator.ts`) uses `HybridMemoryService` for planning context: summary retrieval first, raw replay by `rawRefs` second.
- If no summary hit is found, orchestrator falls back to session memory (`MemoryStore.read(sessionId)`).

## Main Conversation Runtime

- Main conversation flow is split between:
  - `src/core/orchestrator.ts`: ingress normalization, direct-command handling, runtime selection, memory append/audit wiring.
  - `src/core/conversation/classic/`: legacy `route -> plan -> tool/respond` chain.
  - `src/core/conversation/agent/`: windowed message-based runtime with short-lived skill lease.
  - `src/core/conversation/shared.ts`: tool execution, memory retrieval, skill/tool context helpers.
  - `src/core/conversation/benchmarkService.ts`: admin benchmark runner for runtime mode comparison.
- Runtime mode selection is controlled by `MAIN_CONVERSATION_MODE` and can be overridden per request in admin benchmark runs.
- Windowed dialogue state belongs in `src/memory/conversationWindowService.ts` + `src/memory/conversationWindowStore.ts`.

## LLM Provider Selection

- Main flow provider selection is persisted in store key `llm.providers`.
- `src/engines/llm/provider_store.ts` owns provider profiles and `default/routing/planning` selector ids.
- `src/core/orchestrator.ts` resolves routing/planning providers by step.
- Runtime domains `topic-summary` / `market-analysis` should prefer explicit `provider-id` selections.
- Admin API entry points (`src/ingress/admin.ts`):
  - `GET /admin/api/llm/providers`
  - `PUT /admin/api/llm/providers`
  - `POST /admin/api/llm/providers/default`
  - `DELETE /admin/api/llm/providers/:id`

## WeCom Menu Admin And Callback Routing

- WeCom transport split:
  - `src/ingress/wecom.ts`: direct callback ingress.
  - `src/ingress/wecomBridge.ts`: local bridge SSE client.
  - `tools/wecom-bridge.go` / `tools/wecom-bridge.js`: public bridge receiver/proxy.
- Click callbacks enter core as raw event envelopes; centralized `EventKey` dispatch resolution remains in `src/core/orchestrator.ts`.
- Menu config/event runtime entrypoint is `src/observable/menuService.ts` with helpers under `src/observable/menu/{store,normalize,publish}.ts`.
- WeCom menu publish client is `src/integrations/wecom/menuClient.ts` and uses bridge proxy (`/proxy/menu/create`).
- Admin API entry points:
  - `GET /admin/api/wecom/menu`
  - `PUT /admin/api/wecom/menu`
  - `POST /admin/api/wecom/menu/publish`

## Direct Input Mapping And `/ha` Direct Route

- Direct input mapping config service: `src/config/directInputMappingService.ts`.
- Store key: `direct-input.mappings`.
- Orchestrator applies this mapping before normal direct shortcut/toolcall flow.
- Slash commands are not overridden by direct input mapping.
- Admin API:
  - `GET /admin/api/direct-input-mappings`
  - `PUT /admin/api/direct-input-mappings`
- `/ha` command registration is in `src/tools/homeAssistantTool.ts`; real execution logic is in `src/integrations/homeassistant/service.ts`.

## Market Admin API Entry Points

- Market admin APIs are owned by `src/ingress/admin.ts`.
- Current endpoints:
  - `GET /admin/api/market/config`
  - `PUT /admin/api/market/config`
  - `GET /admin/api/market/securities/search`
  - `POST /admin/api/market/portfolio/import-codes`
  - `GET /admin/api/market/runs`
  - `POST /admin/api/market/run-once`

## Market Analysis Runtime Notes

- `src/integrations/market-analysis/` should stay layered by stable capability (for example `fund/`, `reporting/`, and root entrypoints).
- `fund/fund_prompt_builder.ts` owns fund prompt construction.
- `fund/fund_analysis_service.ts` must apply fund base-data guardrails (base quote/NAV failure => skip downstream feature/rule/LLM for that fund with explicit logging).
- Fund news retrieval should separate planning (`market-analysis` side) from provider execution (`src/integrations/search-engine/`).
- Search engine profiles are owned by `src/integrations/search-engine/store.ts` + `service.ts`; current providers include `serpapi.ts` and `qianfan.ts`.
- When selected search engine is unavailable/disabled/failed, keep flow fail-open and log `search_status:*` with provider metadata.
- Markdown report/image pipeline should stay in `market-analysis/reporting` + `src/integrations/codex/markdownReport.ts` + `src/integrations/md2img/`.

## Structural Change Checklist

1. Move directories/files.
2. Update imports (`rg` old paths).
3. Update docs together when structure/placement changes: `AGENTS.md` + `docs/PROJECT_STRUCTURE.md`; update `README.md` when behavior/config/operator-facing usage changes.
4. Run validation:
   - `npx tsc -p tsconfig.json`
   - `npm run test:evolution`
   - `npm run build` when admin API/admin-web is touched.
