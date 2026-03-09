# Project Structure Plan

This document explains the intended module layout and placement rules.

## Current Structure (Target)

```text
src/
  core/            # Orchestrator, router, core runtime flow
    re-agent/      # /re sub-agent runtime (ReAct loop + modules)
  ingress/         # Inbound adapters (http/wecom/admin/notify/bridge)
  integrations/    # External API adapters (flat by domain)
    rag/           # RAG search adapter
    mcp/           # MCP JSON-RPC adapter
    multiagent/    # Planner/Critic collaboration adapter
    topic-push/    # Topic push runtime (planning/mutations/storage split)
    market-analysis/ # Market analysis runtime (signals/storage/format split)
    evolution-operator/ # Evolution runtime engine + state orchestration
  tools/   # Tool handlers and schemas (one tool per file, self-register)
  storage/         # Persistence abstraction (store registration/get/set)
  scheduler/       # Schedule/user domain
  memory/          # Session memory domain
  engines/         # LLM engine implementations
  config/          # Runtime config services
  skills/          # Skill metadata manager only
  callback/        # Async callback dispatch
```

Repo root:

```text
tools/             # Standalone scripts and bridge binaries/helpers
skills/            # Skill packages (SKILL.md declarations only)
admin-web/         # Admin frontend
```

Note: `handler.js` is deprecated. Keep runtime execution in `src/tools/` and integrations flat under `src/integrations/`.

## Why This Refactor

1. `src/tools` and root `tools/` were semantically different but name-colliding.
2. `endpoints` and `ingress` responsibilities were close enough to blur module boundaries.
3. Persistence access was becoming path-centric in domain modules.

## Naming Decisions

- `src/tools` -> `src/tools`
  - Clarifies: this is tool layer, not scripts.
- `src/endpoints` -> `src/integrations`
  - Clarifies: these modules are outbound adapters to third-party systems.

## Placement Rules

- If code consumes third-party API protocol directly -> `src/integrations/`.
- If code is LLM-callable tool (including skill-bound tools) -> `src/tools/`.
- If code only translates inbound requests to internal model -> `src/ingress/`.
- If code belongs to `/re` sub-agent runtime loop or module contract -> `src/core/re-agent/`.
- If code stores persistent domain state -> use `src/storage/persistence.ts` API only.

## `/re` Memory Routing

- User input with `/re` prefix reads/writes ReAgent memory store.
- Assistant output with `/re` prefix writes ReAgent memory store.
- Non-`/re` traffic uses the default session memory store.

## `/re` Command Contract

- `/re <question>`: start sub-agent conversation.
- `/re help`: show help text.
- `/re reset`: reset sub-agent memory for current session.
- Sub-agent replies should keep `/re` prefix.

## Refactor Checklist For Future Moves

1. Move directories/files.
2. Update all imports (`rg` the old path).
3. Update runtime docs (`README.md`, `AGENTS.md`, this file if needed).
4. Run `npx tsc -p tsconfig.json` and domain tests.
