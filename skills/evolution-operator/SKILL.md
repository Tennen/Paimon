---
name: evolution-operator
description: Trigger and inspect the built-in evolution engine from chat endpoints (WeCom/HTTP) via direct commands. Supports goal enqueue, status query, and manual tick.
keywords: ["evolution", "coding", "codex", "goal", "自进化", "代码", "需求实现", "状态", "重试"]
prefer_tool_result: true
runtime_tool: skill.evolution-operator
runtime_action: execute
runtime_params: ["input"]
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

- Runtime tool uses in-process evolution runtime context directly (no HTTP fetch).
- Admin routes and runtime tool share the same evolution business abstraction.

Runtime tool contract (LLM must output JSON)

```json
{
  "tool": "skill.evolution-operator",
  "action": "execute",
  "params": {
    "input": "<完整用户请求>"
  }
}
```

Rules:

- Keep `/evolve` `/coding` `/codex` command text intact in `params.input`.
- `action` must be `execute`.
