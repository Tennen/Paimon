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
  - No orchestration/business workflow state.

- `src/runtime-tools/`
  - Tool definitions exposed to orchestration/LLM.
  - Register schemas/handlers; orchestrate integration calls.
  - Must not own persistence policy.

- `src/core/`
  - Orchestration and tool routing.
  - No direct filesystem persistence and no vendor-specific API code.

- `src/storage/`
  - Single persistence gateway.
  - Callers should use `registerStore`, `getStore`, `setStore`.
  - Business modules must not depend on file paths.

- `src/evolution/`, `src/scheduler/`, `src/memory/`
  - Domain services/state models.
  - Persistence access only through `src/storage/persistence.ts`.

## Directory Rules

- New external platform clients go under `src/integrations/<platform>/`.
- New LLM-callable tools go under `src/runtime-tools/`.
- Standalone operational scripts go under repo root `tools/` (not `src/`).
- New cross-cutting infrastructure modules go under `src/<infra-domain>/` and must be reusable.

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
