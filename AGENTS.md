# Paimon Coding Agent Guide

This file defines hard constraints for coding agents working in this repository.

## What Belongs Here

- `AGENTS.md` is for implementation constraints, architecture boundaries, and change safety rules.
- `README.md` is for product capabilities, setup, and operator-facing usage.
- `docs/PROJECT_STRUCTURE.md` is the detailed module map and placement reference.
- When behavior/config/API changes are user-visible, update both docs in the same change.

## Architecture Boundaries

- `src/ingress/`
  - Transport adapters only (HTTP, WeCom callback, bridge stream, admin routes).
  - Parse/validate request and translate to internal envelope/service calls.
  - Do not embed external API client logic here.
  - WeCom transport split must stay explicit:
    - `src/ingress/wecom.ts` is the direct public WeCom callback ingress. It receives external WeCom HTTP/XML callbacks and returns synchronous callback replies.
    - `src/ingress/wecomBridge.ts` is the local bridge client. It proactively connects to `WECOM_BRIDGE_URL` SSE, consumes bridge-delivered payloads, and sends outbound replies via `src/integrations/wecom/sender.ts`.
    - `tools/wecom-bridge.go` / `tools/wecom-bridge.js` are the public bridge receivers/proxies. They accept external WeCom callbacks and expose bridge-side proxy endpoints.
    - Do not treat `src/ingress/wecomBridge.ts` as another direct WeCom callback receiver; raw WeCom callback payload/protocol changes belong in `src/ingress/wecom.ts` or `tools/wecom-bridge.*` depending deployment mode.
    - When a WeCom callback carries `EventKey`, ingress should only normalize it into an internal event envelope. `EventKey -> dispatchText` resolution belongs in core orchestration, not in individual ingress adapters.

- `src/core/`
  - Orchestration and tool routing.
  - No direct filesystem persistence and no vendor-specific API code.
  - `src/core/conversation/` owns main conversation runtime variants, shared phase helpers, and benchmark services for the main dialogue chain.
  - Keep main conversation orchestration split by stable responsibility (`shared`, `classic`, `agent`, `benchmark`, `types`) instead of growing `orchestrator.ts` into a single mixed-responsibility file.
  - `src/core/re-agent/` keeps ReAct loop/runtime orchestration only; tool/vendor protocol details stay outside core.

- `src/config/`
  - Runtime configuration readers/writers and config services only.
  - No business orchestration logic.

- `src/engines/llm/`
  - Provider runtime adapters only (`ollama`, `llama-server`, `openai`, etc.).
  - Keep a unified `LLMEngine` contract; do not add skill/business workflow branching here.
  - Provider-specific quota/account state belongs in `src/integrations/<provider>/` + `src/storage/`.

- `src/engines/stt/`
  - STT provider runtime adapters only (`fast-whisper`, etc.).
  - Keep provider selection/retry/timeout behavior here, not in ingress/core.

- `src/integrations/`
  - External system adapters and domain runtime modules.
  - Encapsulate HTTP/WebSocket/protocol details.
  - Default: no cross-domain orchestration/business workflow state.
  - Shared codex capabilities (CLI adapter/config/markdown report runner) belong in `src/integrations/codex/`.
  - Dedicated markdown-to-image rendering runtime belongs in `src/integrations/md2img/`; other user-facing message/media adapters stay in `src/integrations/user-message/` when needed.
  - Runtime-domain exceptions currently allowed:
    - `src/integrations/evolution-operator/`
    - `src/integrations/topic-summary/`
    - `src/integrations/market-analysis/`
    - `src/integrations/writing-organizer/`
  - Prefer flat domain roots (`src/integrations/<domain>/`), no `integrations/tools` layer.
  - Flatness has a limit: if one domain directory grows beyond 10 files, or if multiple files in that directory clearly belong to different abstraction layers or capability groups, you must split it into subdirectories.
  - When splitting a domain, group by stable capability or responsibility (for example `fund/`, `reporting/`, `adapters/`) and keep cross-capability entrypoints in the domain root.

- `src/tools/`
  - Independent tool definitions exposed to orchestration/LLM (for example: `terminal`, `homeassistant`).
  - Register schemas/handlers and call integrations.
  - Must not contain skill-specific orchestration logic or persistence policy.

- `src/storage/`
  - Single persistence gateway.
  - Callers should use `registerStore`, `getStore`, `setStore`.
  - Business modules must not depend on file paths.

- `src/observable/`
  - Admin-defined trigger/menu config and callback-event dispatch only.
  - No direct vendor HTTP/API client code here; WeCom API access stays in `src/integrations/wecom/`.
  - No ingress parsing here; ingress only translates requests into observable service calls.

- `src/scheduler/`, `src/memory/`
  - Domain services and state management.
  - Persistence access only through `src/storage/persistence.ts`.

- `admin-web/`
  - Admin UI only.
  - Must consume backend contracts from shared type definitions (`admin-web/src/types/admin.ts`).

## Directory Rules

- New external platform clients go under `src/integrations/<platform>/`.
- New integration modules stay flat under `src/integrations/<domain>/`.
- New independent LLM-callable tools go under `src/tools/`.
- Standalone operational scripts go under repo root `tools/` (not `src/`).
- New cross-cutting infrastructure modules go under `src/<infra-domain>/` and must be reusable.
- When a main chain or runtime refactor introduces multiple phases/modes, create a dedicated subdirectory (for example `src/core/conversation/`) and split files by stable responsibility. Do not keep routing/bootstrap/planning/acting/admin benchmark wiring in one oversized file.
- If a module starts mixing runtime state machine logic, prompt construction, persistence access coordination, and admin contracts, split it before adding more behavior. Prefer `types.ts`, `shared.ts`, per-mode `runtime.ts`, and adjacent service files over a single catch-all module.

## Skill Rules

- `skills/<name>/` keeps declarative spec only (`SKILL.md`).
- Do not add runtime logic in `skills/<name>/handler.js`.
- `src/skills/` should only keep `skillManager` and related metadata loading.
- Tool implementation/registration must live in:
  - `src/tools/*Tool.ts` (one tool per file, self-register to `ToolRegistry`)
  - `src/integrations/<domain>/` for external API adapters
- Every executable skill should declare in `SKILL.md` frontmatter:
  - `tool`
  - `action`
  - `params`
- Planner output contract should use JSON:
  - `tool`
  - `action`
  - `params`

## API And Contract Rules

- Keep request/response schemas backward compatible unless the change explicitly includes migration.
- For user-directed logic iterations or refactors, default to replacing old logic and related storage/display contracts in the same change; do not add backward-compatibility shims unless the user explicitly asks for compatibility or migration.
- When a user explicitly switches a feature/command/runtime from an old path to a new path, treat the old path as removed unless the user asks for compatibility. Do not add legacy-mode flags, compat branches, silent fallbacks, or explicit "old flag removed" error handling just to acknowledge the old path; update the active path directly and delete the obsolete branch.
- If admin API schema changes, update `admin-web/src/types/admin.ts` and affected UI components in the same change.
- New env vars must be documented in `.env.example`; remove dead env vars when no longer used.
- LLM provider selection contract must stay centralized in `src/engines/llm/engine_factory.ts`.

## Persistence Rules

- Do not add feature-specific `*_FILE`, `*_DIR`, or path env variables for persistent state.
- Add a logical key in `DATA_STORE` and map it in `STORE_FILE_MAP`.
- Register store once via `registerStore(name, init)` in owning module initialization.
- Use `getStore<T>(name)` and `setStore(name, payload)` for all reads/writes.
- Keep migration logic inside owning store/service when schema/location changes.

## Memory Rules

- Keep global memory semantics stable:
  - raw memory stores original conversation records (no semantic rewrite of original content)
  - summary memory is derived/structured and references raw records via ids/refs
- Do not couple memory logic to concrete filesystem paths.
- Changes to memory schema must include normalization/migration in memory service layer.

## Re-Agent Rules

- `/re` runtime contract belongs in `src/core/re-agent/` + `src/memory/`, not in ingress/integration shims.
- Keep `/re` command semantics stable unless change explicitly includes README/docs updates.
- If `/re` command contract or memory routing changes, sync `README.md` and `docs/PROJECT_STRUCTURE.md`.

## Code Style Rules

- TypeScript first; keep exported APIs explicitly typed.
- Avoid `any`; if unavoidable, isolate and narrow quickly.
- Avoid `// @ts-nocheck` for new code; if unavoidable, document reason and scope narrowly.
- Keep functions focused; split large mixed-responsibility functions.
- Prefer pure helpers for normalization/validation.
- Validate external input at boundaries (`ingress`, integration adapters) before entering core flow.
- Preserve existing language style in user-facing text (current codebase mixes Chinese/English intentionally).
- Keep logs actionable: include subsystem context and avoid swallowing errors silently.
- If interface code or critical logic enters a `catch` path and then falls back/degrades/compat-returns, it must emit an explicit error log in that `catch` branch with subsystem context, target/input identity, and the fallback behavior. Do not silently return fallback data.

## Change Safety Checklist

- Update imports after any directory/module move.
- If you add/change an LLM provider:
  - update `src/engines/llm/engine_factory.ts` provider normalization + factory branch
  - keep provider fallback logic inside engine/integration layer (not ingress/core)
  - update `.env.example` and `README.md` provider config examples in the same change
- If you add/change STT provider behavior, keep provider selection in `src/engines/stt/` and sync `.env.example`.
- If admin API or `admin-web/` is changed, run `npm run build` (includes admin-web build) before merge.
- Run at least:
  - `npx tsc -p tsconfig.json`
  - `npm run test:evolution`
- If user-visible command/API/config changes, sync README sections in the same change.
- If directory/module placement changes, sync both `AGENTS.md` and `docs/PROJECT_STRUCTURE.md` in the same change.
