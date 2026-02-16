---
name: chatgpt-bridge
description: Use ChatGPT Web (already logged-in Chrome) for general Q&A, knowledge lookup, explanation, summarization, and open-domain queries that are not covered by other local skills. Connect via Chrome remote-debugging-port and return ChatGPT text plus reply images.
install: npm install puppeteer-core --no-save
keywords: ["chatgpt", "openai", "gpt", "问答", "查询", "解释", "总结", "科普", "搜索", "查一下", "what", "how", "why", "where", "when"]
---

# ChatGPT Bridge Skill

Bridge user messages to ChatGPT Web through an existing logged-in Chrome session.

Environment variables

- `CHATGPT_REMOTE_DEBUGGING_PORT` (default `9222`)
- `CHATGPT_REMOTE_DEBUGGING_URL` (default `http://127.0.0.1:<PORT>`)
- `CHATGPT_BROWSER_WS_ENDPOINT` (optional, overrides URL/PORT)
- `CHATGPT_URL` (default `https://chatgpt.com/`)
- `CHATGPT_PAGE_TIMEOUT_MS` (default `120000`)
- `CHATGPT_GENERATION_TIMEOUT_MS` (default `300000`)
- `CHATGPT_STOP_APPEAR_TIMEOUT_MS` (default `25000`)
- `CHATGPT_IMAGE_MIN_WIDTH` (default `80`)
- `CHATGPT_IMAGE_MIN_HEIGHT` (default `80`)
- `CHATGPT_SCREENSHOT`, `SCREENSHOT`, or `screenshot` set to `true` to include chat-area long screenshot

Behavior

- Send the incoming message to ChatGPT input box.
- Wait for `Stop generating` to appear and then disappear back to `Send`/`Regenerate`.
- Extract last assistant reply text and images.
- Optionally include a full chat-area screenshot when screenshot flag is enabled.
- Execute requests sequentially to avoid concurrent tab actions.
