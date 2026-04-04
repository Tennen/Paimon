# Paimon Coding Agent Guide

This file defines hard constraints for coding agents working in this repository.

## What Belongs Here

- `AGENTS.md` is for implementation constraints, code rules, and change safety rules.
- `README.md` is for product capabilities, setup, and operator-facing usage.
- `docs/PROJECT_STRUCTURE.md` is the canonical structure/module placement reference.
- When behavior/config/API changes are user-visible, update `README.md` in the same change.
- When adding/removing top-level integration directories (for example a new `src/integrations/*` domain), update `docs/PROJECT_STRUCTURE.md` and keep this file aligned by reference in the same change.
- When directory/module placement changes, update both `AGENTS.md` and `docs/PROJECT_STRUCTURE.md` in the same change.

## Structure Rules (Authoritative Reference)

- All structure and placement rules must follow `docs/PROJECT_STRUCTURE.md`.
- This includes (but is not limited to):
  - backend/admin-web directory boundaries
  - ingress/core/integrations/tools/storage/observable boundaries
  - admin-web Zustand/store/section hook layering
  - directory evolution and file-splitting thresholds
- Do not duplicate or fork structure rules here. If a structure rule changes, update `docs/PROJECT_STRUCTURE.md` first, then keep this file aligned by reference.

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
- For large-scope changes, use module-scoped incremental commits by default; only skip this when the change cannot be reasonably covered by small-step commits.
- Unless the user explicitly asks not to, every completed implementation task should end with a `git commit` and `git push` for the finished changes.
- If user-visible command/API/config changes, sync README sections in the same change.
- If directory/module placement changes, sync both `AGENTS.md` and `docs/PROJECT_STRUCTURE.md` in the same change.
