---
name: wecom-codex-operator
description: Execute engineering tasks from WeCom user requests through codex-cli, track task lifecycle/status, expose key CLI output milestones, and support user-confirmed release steps (git commit, git push, pm2 restart 0).
keywords: ["codex", "codex-cli", "wecom", "wechat", "微信", "任务", "状态", "进度", "确认完成", "提交", "发布", "重启"]
---

# WeCom Codex Operator

Use this skill to run codex-cli tasks triggered by WeCom messages and track end-to-end progress.

Command patterns

- Start a task: send natural language task requirements, for example `请帮我实现 xxx`.
- Query status: include `状态`/`进度`/`status` and optionally a task id.
- Confirm release: include `确认`/`confirm` and optionally task id and commit message.

Behavior

- Start: create a task id, run `codex exec --json` in background, record milestones and key output.
- Status: return current state, recent milestones, and final output summary if available.
- Confirm: after task reaches confirmation state, execute:
  1. `git add -A`
  2. `git commit --allow-empty -m <message>`
  3. `git push`
  4. `pm2 restart 0`

Notes

- The skill keeps per-task records under `data/codex-cli-skill/` for tracking.
- If codex-cli fails, status shows the error and task remains traceable.
