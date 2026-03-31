---
name: topic-summary
description: Generate daily AI engineering digest from configurable RSS sources, with source CRUD via direct command.
keywords: ["topic summary", "rss", "digest", "ai news", "日报", "新闻摘要"]
preferToolResult: true
tool: skill.topic-summary
action: execute
params: ["input"]
---

# Topic Summary Skill

Use this skill to generate a daily AI digest and manage RSS sources.
It also supports multi-profile isolation (for example AI profile vs non-AI profile) so subscriptions and dedup state do not mix.

Direct commands:

- `/topic`
- `/topic run`
- `/topic run --profile ai-engineering`
- `/topic profile list`
- `/topic profile add --name "AI Daily" --id ai-engineering`
- `/topic profile add --name "Crypto Daily" --id crypto --clone-from ai-engineering`
- `/topic profile use crypto`
- `/topic source list`
- `/topic source list --profile crypto`
- `/topic source add --name "OpenAI Blog" --category engineering --url https://openai.com/blog/rss.xml --profile ai-engineering`
- `/topic source update <id> --weight 1.2 --enabled true`
- `/topic source enable <id>` / `/topic source disable <id>`
- `/topic source delete <id>`
- `/topic config`
- `/topic state`

Tool contract (LLM must output JSON)

```json
{
  "tool": "skill.topic-summary",
  "action": "execute",
  "params": {
    "input": "<完整用户请求>"
  }
}
```

Rules:

- Keep original `/topic ...` command text in `params.input`.
- `params` only contains `input`.
