---
name: codex-operator
description: Query and update evolution Codex runtime settings (model and reasoning effort) through admin API.
keywords: ["codex", "evolution", "model", "reasoning effort", "配置", "模型", "推理强度"]
prefer_tool_result: true
---

# Codex Operator

Use this skill to inspect or update Codex configuration used by the evolution engine.

Direct command:

- `/codex status`
- `/codex model`
- `/codex model <model>`
- `/codex effort`
- `/codex effort <minimal|low|medium|high|xhigh>`

You can clear overrides via:

- `/codex model default`
- `/codex effort default`

This skill talks to admin APIs:

- `GET /admin/api/config`
- `POST /admin/api/config/codex`
