---
name: market-analysis
description: Deterministic A-share/ETF/fund market analysis capability for midday/close phases. Fetches market data, computes MA and volume features, runs rule engine, optionally generates LLM explanation, and persists structured results.
keywords: ["market", "analysis", "a股", "etf", "基金", "盘中", "收盘", "行情", "趋势", "信号", "market analysis"]
preferToolResult: true
---

# Market Analysis Capability

Use this skill to run deterministic market analysis for two phases:

- `midday` (13:30)
- `close` (15:15)

Direct command:

- `/market midday`
- `/market close`
- `/market status`
- `/market portfolio`

Input contract

- Holdings are loaded from `data/market-analysis/portfolio.json`.
- Phase is parsed from user input (`midday`/`close`) or inferred from local time.

Output contract

- Structured signal result:
  - `phase`
  - `marketState`
  - `assetSignals[]`
- Optional LLM summary (explanation only, no signal mutation)
- Persisted run snapshots under `data/market-analysis/runs/`
