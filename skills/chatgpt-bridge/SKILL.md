---
name: chatgpt-bridge
description: Use ChatGPT Web (already logged-in Chrome) for general Q&A, knowledge lookup, explanation, summarization, and open-domain queries that are not covered by other local skills. Connect via Chrome remote-debugging-port and return ChatGPT text plus reply images.
install: npm install puppeteer-core --no-save
prefer_tool_result: true
keywords: ["chatgpt", "openai", "gpt", "问答", "查询", "解释", "总结", "科普", "搜索", "查一下", "what", "how", "why", "where", "when"]
tool: skill.chatgpt-bridge
action: execute
params: ["input"]
---

# ChatGPT Bridge Skill

Bridge user messages to ChatGPT Web through an existing logged-in Chrome session and return text/images.

Tool contract (LLM must output JSON)

```json
{
  "tool": "skill.chatgpt-bridge",
  "action": "execute",
  "params": {
    "input": "<完整用户请求>"
  }
}
```

Rules:

- `tool`/`action`/`params` key names must be exact.
- `params.input` must keep full user intent (do not drop `/gpt ...` command content).
- Do not add extra params.

Output shape

- Success: `{ "text": string, "images"?: Image[] }`
- Failure: return tool error text.
