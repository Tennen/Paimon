---
name: topic-push
description: Generate daily AI engineering digest from configurable RSS sources, with source CRUD via direct command.
keywords: ["topic push", "rss", "digest", "ai news", "engineering", "日报", "新闻推送", "订阅", "source"]
preferToolResult: true
tool: skill.topic-push
action: execute
params: ["input"]
---

# Topic Push Skill

Use this skill to generate a daily AI digest and manage RSS sources.

Direct commands:

- `/topic`
- `/topic run`
- `/topic source list`
- `/topic source add --name "OpenAI Blog" --category engineering --url https://openai.com/blog/rss.xml`
- `/topic source update <id> --weight 1.2 --enabled true`
- `/topic source enable <id>` / `/topic source disable <id>`
- `/topic source delete <id>`
- `/topic config`
- `/topic state`

Tool contract (LLM must output JSON)

```json
{
  "tool": "skill.topic-push",
  "action": "execute",
  "params": {
    "input": "<完整用户请求>"
  }
}
```

Rules:

- Keep original `/topic ...` command text in `params.input`.
- `params` only contains `input`.
