# Phase 1 · Home Assistant Tool（在 Phase 0 骨架之上）

> 🎯 目标：
> 在不破坏 Phase 0 架构的前提下，引入 **第一个真实 Tool：Home Assistant**

---

## ✅ Phase 1 · Codex Prompt

```text
在 Phase 0 的单体 TypeScript 服务骨架基础上，实现 Phase 1：Home Assistant Tool。

【前提】
- 不允许改动 Phase 0 的核心架构思想：
  - 单体服务（single-process）
  - Session 串行（同一 sessionId 严格顺序）
  - Orchestrator 流水线不变
- 可以新增文件，但不要重构已有模块职责。

【新增功能目标】
- 新增一个真实 Tool：HomeAssistantTool
- 允许 LLM 输出 action.type = "ha.call_service" 和 "ha.get_state"
- 通过 Home Assistant REST API 执行动作

【Home Assistant Tool 规范】
- action.type = "ha.call_service"
  - params:
    - domain: string
    - service: string
    - entity_id: string | string[]
    - data?: object
- action.type = "ha.get_state"
  - params:
    - entity_id: string

【实现要求】
- 使用 fetch / axios 调用 Home Assistant REST API
- HA Base URL 和 Token 从环境变量读取：
  - HA_BASE_URL
  - HA_TOKEN
- 请求头必须使用 Bearer Token
- 实现最小错误处理（HTTP 非 2xx 视为失败）

【安全与约束（Phase 1 级别）】
- 实现 entity 白名单：
  - 从配置中读取允许的 entity_id 前缀或完整列表
  - 非白名单 entity 直接拒绝执行
- 暂不实现复杂权限系统（后续 Phase 2）

【Mock LLM 调整】
- 更新 MockLLM 行为：
  - 输入包含 "light" 或 "灯" → 返回 ha.call_service 示例
  - 输入包含 "status" 或 "状态" → 返回 ha.get_state 示例
- 其他输入维持原行为

【审计日志】
- audit.jsonl 中新增字段：
  - tool: "homeassistant"
  - ha_action: call_service / get_state
  - entity_id

【验收标准】
- 可以通过 curl /ingress 触发一次 HA service 调用
- HA 中对应实体状态发生变化
- 服务未引入并发问题（session 串行仍然成立）

【不做事项】
- 不接企业微信
- 不接 STT / 真实 LLM
- 不接 Shortcuts

【Pending】
- 摄像头截图“脚本返回路径”的方案暂缓，当前使用 `camera_proxy` + REST `/api/states` 补齐 camera 实体。
```

---

# Phase 2 · 多入口接入（Ingress 扩展）

> 🎯 目标：
> 在 **不改 Orchestrator、不改 Tool 层** 的情况下，引入多个入口
> 验证你这个系统的「入口只是 adapter」这一核心设计是否成立

---

## ✅ Phase 2 · Codex Prompt

```text
在 Phase 1 基础上，实现 Phase 2：多入口（Ingress Adapter）接入。

【核心原则（强约束）】
- Orchestrator 代码不得感知入口来源
- Tool 层不得感知入口来源
- 新入口只能通过 IngressAdapter 接口接入
- 所有入口最终都必须产出统一的 Envelope 结构

【Phase 2 新增入口】
1) HTTP API 扩展（已有入口保留）
   - 新增 GET /health
   - 新增 GET /sessions（只读调试用）

2) WeCom Ingress Adapter（企业微信）
   - 接收文本消息（先不处理语音）
   - 将 WeCom 消息转换为 Envelope：
     - source = "wecom"
     - sessionId = 群ID或用户ID
     - requestId = messageId
   - 支持回文本消息

【实现要求】
- 新增 ingress/wecom 模块
- 不允许在 wecom adapter 中：
  - 调用 LLM
  - 调用 Tool
  - 写业务逻辑
- WeCom adapter 只负责：
  - 验签
  - 收消息
  - 构造 Envelope
  - 投递给 SessionManager
  - 发送 Response

【并发要求】
- WeCom 群聊中的多条消息：
  - 同一个群必须按顺序执行
  - 不同群可以并行

【日志与审计】
- audit.jsonl 中新增字段：
  - source
  - ingress_message_id

【Mock LLM 行为保持 Phase 1】
- 不引入真实 STT / LLM

【验收标准】
- HTTP 和 WeCom 两种入口都能触发 HA 控制
- 同一群内顺序不乱
- WeCom adapter 不包含业务逻辑

【不做事项】
- 不处理语音
- 不做权限/身份体系
- 不接 Shortcuts
```

---

# Phase 3 · macOS Shortcuts（Reminders / Notes）

> 🎯 目标：
> 把系统第一次**真正写入 Apple 生态**
> Shortcut 是执行器，不是入口

---

## ✅ Phase 3 · Codex Prompt

```text
在 Phase 2 基础上，实现 Phase 3：macOS Shortcuts 执行器（Reminders / Notes）。

【核心原则（强约束）】
- Shortcuts 只能作为 Tool 的执行手段
- Shortcuts 不作为入口
- LLM 输出仍然是结构化 Action

【新增 Tool】
1) RemindersTool
   - action.type = "reminder.create"
   - params:
     - title: string
     - due?: ISO datetime
     - list?: string
     - notes?: string

2) NotesTool
   - action.type = "note.create"
   - params:
     - folder?: string
     - title: string
     - content: string

【Shortcuts 执行方式】
- 使用 macOS CLI：
  - shortcuts run "AI_CreateReminder" --input <json>
  - shortcuts run "AI_CreateNote" --input <json>
- 新增 ShortcutsRunner：
  - 封装 child_process.exec / spawn
  - 支持 timeout（默认 10s）
  - 捕获 stdout / stderr
  - stdout 作为 ToolResult.output

【实现要求】
- ShortcutsRunner 为通用组件
- RemindersTool / NotesTool 只负责参数映射
- 输入 JSON 必须完整传给快捷指令
- 不在 Node 中直接操作系统数据库

【Mock LLM 调整】
- 输入包含 “提醒 / remind” → reminder.create
- 输入包含 “记一下 / note” → note.create
- 其他维持原逻辑

【审计日志】
- audit.jsonl 中新增字段：
  - tool: "shortcuts"
  - shortcut_name
  - execution_time_ms

【验收标准】
- 从 HTTP 或 WeCom 输入一句自然语言
- 成功在 macOS Reminders / Notes 中创建内容
- iCloud 同步到 iPhone 可见

【不做事项】
- 不处理 iOS 端快捷指令
- 不做 Shortcut 反向回调
```
