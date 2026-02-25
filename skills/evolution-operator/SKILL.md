---
name: evolution-operator
description: Trigger and inspect the built-in evolution engine from chat endpoints (WeCom/HTTP) via direct commands. Supports goal enqueue, status query, and manual tick.
keywords: ["evolution", "coding", "codex", "goal", "自进化", "代码", "需求实现", "状态", "重试"]
prefer_tool_result: true
---

# Evolution Operator

Use this skill to control the in-process evolution engine through chat endpoints.

Direct commands:

- `/evolve <goal text>`
- `/coding <goal text>`
- `/evolve status`
- `/evolve status <goalId>`
- `/evolve tick`
- `/evolve help`
- `/codex status`
- `/codex model`
- `/codex model <model>`
- `/codex effort`
- `/codex effort <minimal|low|medium|high|xhigh>`

Commit behavior:

- Goal creation supports optional `commitMessage`.
- Use `/evolve <goal> commit: <message>` or `/evolve <goal> 提交: <message>`.
- If `commitMessage` is omitted, evolution engine auto-generates commit message before commit.
- After task success, engine auto commit + push; push failure makes the goal fail.

Runtime model:

- Handler uses in-process evolution runtime context directly (no HTTP fetch).
- Admin routes and handler share the same evolution business abstraction.
