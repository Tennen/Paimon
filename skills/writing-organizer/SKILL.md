---
name: writing-organizer
description: Organize fragmented writing inputs into topic-based summary/outline/draft with rolling raw storage and one-step restore. Use this when user asks to append notes, inspect topic state, run summarize, or rollback writing state.
keywords: ["writing", "organizer", "summary", "draft", "写作", "整理", "草稿"]
preferToolResult: true
tool: skill.writing-organizer
action: execute
params: ["input"]
---

# Writing Organizer Skill

Direct commands:

- `/writing topics`
- `/writing show <topic-id>`
- `/writing append <topic-id> "一段新内容"`
- `/writing summarize <topic-id>`
- `/writing restore <topic-id>`
- `/writing set <topic-id> <summary|outline|draft> "内容"`

Tool contract (LLM must output JSON)

```json
{
  "tool": "skill.writing-organizer",
  "action": "execute",
  "params": {
    "input": "<完整用户请求>"
  }
}
```

Rules:

- Keep original `/writing ...` command text in `params.input`.
- `params` only contains `input`.
