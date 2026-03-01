# Project Structure Plan

This document explains the intended module layout and placement rules.

## Current Structure (Target)

```text
src/
  core/            # Orchestrator, router, core runtime flow
  ingress/         # Inbound adapters (http/wecom/admin/notify/bridge)
  integrations/    # External API adapters (ha, wecom, ...)
  runtime-tools/   # LLM-callable tool registry and tool handlers
  storage/         # Persistence abstraction (store registration/get/set)
  evolution/       # Self-evolution engine and state domain
  scheduler/       # Schedule/user domain
  memory/          # Session memory domain
  engines/         # LLM engine implementations
  config/          # Runtime config services
  skills/          # Built-in skill runtime helpers
  callback/        # Async callback dispatch
```

Repo root:

```text
tools/             # Standalone scripts and bridge binaries/helpers
skills/            # Skill packages (SKILL.md + optional handler.js)
admin-web/         # Admin frontend
```

## Why This Refactor

1. `src/tools` and root `tools/` were semantically different but name-colliding.
2. `endpoints` and `ingress` responsibilities were close enough to blur module boundaries.
3. Persistence access was becoming path-centric in domain modules.

## Naming Decisions

- `src/tools` -> `src/runtime-tools`
  - Clarifies: this is runtime tool layer, not scripts.
- `src/endpoints` -> `src/integrations`
  - Clarifies: these modules are outbound adapters to third-party systems.

## Placement Rules

- If code consumes third-party API protocol directly -> `src/integrations/`.
- If code exposes capability to orchestrator/LLM -> `src/runtime-tools/`.
- If code only translates inbound requests to internal model -> `src/ingress/`.
- If code stores persistent domain state -> use `src/storage/persistence.ts` API only.

## Refactor Checklist For Future Moves

1. Move directories/files.
2. Update all imports (`rg` the old path).
3. Update runtime docs (`README.md`, `AGENTS.md`, this file if needed).
4. Run `npx tsc -p tsconfig.json` and domain tests.
