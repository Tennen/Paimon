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

Commit behavior:

- Goal creation supports optional `commitMessage`.
- Use `/evolve <goal> commit: <message>` or `/evolve <goal> 提交: <message>`.
- If `commitMessage` is omitted, evolution engine auto-generates commit message before commit.
- After task success, engine auto commit + push; push failure makes the goal fail.

This skill talks to the same admin evolution APIs:

- `POST /admin/api/evolution/goals`
- `GET /admin/api/evolution/state`
- `POST /admin/api/evolution/tick`
