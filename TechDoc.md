## A1. 架构决策（明确约束）

* 语言：**TypeScript（Node.js）**
* 形态：**单体服务（single-process monolith）**
* 并发模型：

  * 同一 `sessionId` **严格串行**
  * tool 执行允许 `await` 异步，但回写状态仍在该 session 队列中
* 非目标：

  * 不拆微服务
  * 不引入消息队列
  * 不做多租户并发优化

---

## A2. 系统分层（逻辑分层，不是部署分层）

```
Ingress Adapter（多入口）
        ↓
Session 串行队列
        ↓
Orchestrator（STT → LLM → Policy → Tool）
        ↓
Tool（HA / Shortcuts / …）
```

---

## A3. 核心数据模型（必须稳定）

```ts
Envelope   // 所有入口输入统一格式
Action     // LLM 输出的唯一执行指令格式
ToolResult // Tool 的执行结果
Response   // 回入口的统一响应
```

这些 **类型定义是“技术文档的一部分”**，不是 Phase 0 的实现要求，但 **Phase 0 必须使用它们**。

---

## A4. 演进路线（设计文档）

* Phase 0：骨架 + Mock（跑得起来）
* Phase 1：Home Assistant
* Phase 2：WeCom + STT + LLM 真接入
* Phase 3：Shortcuts / Reminders / Notes
