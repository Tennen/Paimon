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
    llm/           # LLM provider adapters (ollama/llama-server/openai)
    stt/           # STT provider adapters
  ingress/         # Inbound adapters (http/wecom/admin/notify/bridge)
  integrations/    # Outbound adapters and domain runtimes (flat by domain)
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
- Domain runtime exceptions under integrations are allowed only for explicit runtime domains:
  - `evolution-operator`
  - `topic-summary`
  - `market-analysis`
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

## Structural Change Checklist

1. Move directories/files.
2. Update imports (`rg` old paths).
3. Update docs together: `AGENTS.md`, `README.md`, and this file when relevant.
4. Run validation:
   - `npx tsc -p tsconfig.json`
   - `npm run test:evolution`
   - `npm run build` when admin API/admin-web is touched.
