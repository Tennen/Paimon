# Paimon Coding Agent Guide

This file defines hard constraints for coding agents working in this repository.

## Architecture Boundaries

- `src/ingress/`
  - Transport adapters only (HTTP, WeCom callback, bridge stream, admin routes).
  - Parse/validate request and translate to internal envelope/service calls.
  - Do not embed external API client logic here.

- `src/integrations/`
  - External system adapters only (Home Assistant, WeCom, etc.).
  - Encapsulate HTTP/WebSocket protocol details.
  - Default: no orchestration/business workflow state.
  - Exception: `src/integrations/evolution-operator/` hosts evolution runtime orchestration and state machine.
  - Keep integrations flat by domain (`src/integrations/<domain>/`), no `integrations/tools` layer.

- `src/runtime-tools/`
  - Independent tool definitions exposed to orchestration/LLM (for example: `terminal`, `homeassistant`).
  - Register schemas/handlers and call integrations.
  - Must not contain skill-specific orchestration logic or persistence policy.

- `src/core/`
  - Orchestration and tool routing.
  - No direct filesystem persistence and no vendor-specific API code.

- `src/storage/`
  - Single persistence gateway.
  - Callers should use `registerStore`, `getStore`, `setStore`.
  - Business modules must not depend on file paths.

- `src/integrations/evolution-operator/`, `src/scheduler/`, `src/memory/`
  - Evolution operator domain runtime lives under integration layer.
  - Persistence access only through `src/storage/persistence.ts`.

## Directory Rules

- New external platform clients go under `src/integrations/<platform>/`.
- New integration modules stay flat under `src/integrations/<domain>/`.
- New independent LLM-callable tools go under `src/runtime-tools/`.
- Standalone operational scripts go under repo root `tools/` (not `src/`).
- New cross-cutting infrastructure modules go under `src/<infra-domain>/` and must be reusable.

## Skill Rules

- `skills/<name>/` keeps declarative spec only (`SKILL.md`).
- Do not add runtime logic in `skills/<name>/handler.js`.
- `src/skills/` should only keep `skillManager` and related metadata loading.
- Runtime tool implementation/registration must live in:
  - `src/runtime-tools/*Tool.ts` (one tool per file, self-register to `ToolRegistry`)
  - `src/integrations/<domain>/` for external API adapters
- Every executable skill should declare in `SKILL.md` frontmatter:
  - `runtime_tool`
  - `runtime_action`
  - `runtime_params`
- Planner output contract should use JSON:
  - `tool`
  - `action`
  - `params`

## Persistence Rules

- Do not add feature-specific `*_FILE`, `*_DIR`, or path env variables for persistent state.
- Add a logical key in `DATA_STORE` and map it in `STORE_FILE_MAP`.
- Register store once via `registerStore(name, init)` in owning module initialization.
- Use `getStore<T>(name)` and `setStore(name, payload)` for all reads/writes.
- Keep migration logic inside owning store/service when schema/location changes.

## Code Style Rules

- TypeScript first; keep exported APIs explicitly typed.
- Avoid `any`; if unavoidable, isolate and narrow quickly.
- Keep functions focused; split large mixed-responsibility functions.
- Prefer pure helpers for normalization/validation.
- Preserve existing language style in user-facing text (current codebase mixes Chinese/English intentionally).

## Change Safety Checklist

- Update imports after any directory/module move.
- Run at least:
  - `npx tsc -p tsconfig.json`
  - `npm run test:evolution`
- If admin API schema changes, update `admin-web/src/types/admin.ts` and affected UI components in same change.
