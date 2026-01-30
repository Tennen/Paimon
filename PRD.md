# PRD：本地智能编排服务（Mac mini）

## 1. 产品定位

一个运行在 macOS（Mac mini）上的 **本地智能编排服务（Local Intelligent Orchestrator）**，用于将来自不同入口的自然语言（文本/语音）转化为结构化动作，并执行到各类系统与服务中。

* 入口（Ingress）可扩展：企业微信只是其中之一
* 执行器（Tools）可扩展：Home Assistant、Reminders、Notes 只是起点
* 核心能力：**STT + LLM + Policy + Tool Routing**

---

## 2. 设计目标

### 核心目标（MVP）

1. 支持多入口接入（WeCom 作为首个实现）
2. 支持语音 → STT → LLM → Tool 的完整自动链路
3. 支持至少三类工具：

   * Home Assistant 控制
   * Reminders 写入
   * Notes 写入
4. 系统具备统一的：

   * 权限与安全策略
   * 工具白名单
   * 审计日志
   * 幂等与失败回执

### 长期目标

* 新入口无需改动核心逻辑（如：HTTP API / CLI / HomeKit / 未来 App）
* 新工具无需改动 LLM Prompt 结构（通过 schema 扩展）
* 系统可作为“家庭/个人自动化控制平面”

---

## 3. 非目标（MVP 阶段）

* 高并发多租户 SaaS
* 复杂 UI（仅保留日志/调试接口）
* 长期知识记忆/搜索引擎
* iOS 端无交互远程触发（默认在 Mac 执行）

---

## 4. 总体架构（分层）

```
┌──────────────────────────────┐
│          Ingress 层           │
│  (WeCom / HTTP / CLI / …)     │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│        Orchestrator 核心      │
│  STT · LLM · Policy · Router  │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│        Tool / Connector 层    │
│  HA · Reminders · Notes · …   │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│        System Bridge 层       │
│  macOS Shortcuts / HA API     │
└──────────────────────────────┘
```

---

## 5. 模块分层与职责

### 5.1 Ingress 层（入口适配层）

**职责：**

* 接收外部输入（文本 / 语音）
* 转换为统一内部消息格式
* 处理鉴权 / 来源标识
* 发送执行结果回原入口

**设计要求：**

* 与核心 Orchestrator 解耦
* 不包含任何业务逻辑（不做解析、不调工具）

**统一输入结构（示例）：**

```json
{
  "source": "wecom",
  "user_id": "u123",
  "session_id": "s456",
  "type": "voice",
  "payload": {
    "audio_url": "...",
    "text": null
  },
  "metadata": {
    "group": "family",
    "timestamp": 1730000000
  }
}
```

**首批实现：**

* WeCom Adapter
  **预留实现：**
* HTTP API Adapter
* CLI Adapter
* HomeKit / Homebridge Adapter
* 未来 App / Web UI

---

### 5.2 Orchestrator 核心层（系统大脑）

这是整个系统**唯一有“智能”的地方**。

#### 子模块

1. **STT Manager**

   * 输入：音频
   * 输出：标准化文本
   * 可插拔（whisper.cpp 为默认）

2. **LLM Engine**

   * 输入：用户文本 + 系统 Prompt + 可用工具 schema
   * 输出：结构化 JSON（tool call）
   * 模型：Qwen 4B（指令型）

3. **Policy Engine**

   * 权限校验（用户/入口/工具）
   * 危险动作识别（删除、全局控制等）
   * 二次确认机制
   * 参数合法性校验（时间/数值/实体）

4. **Tool Router**

   * 根据 LLM 输出选择 Tool
   * 保证只调用已注册工具
   * 处理失败重试 / fallback

5. **Audit & State**

   * 请求日志
   * 执行结果
   * request_id（幂等）

---

### 5.3 Tool / Connector 层（能力插件）

**职责：**

* 将“结构化动作”转换为具体系统调用
* 不做自然语言理解
* 不做权限判断（已由 Policy 处理）

#### 统一 Tool 接口

```ts
execute(action: ToolAction): ToolResult
```

#### ToolAction 示例

```json
{
  "type": "reminder.create",
  "params": {
    "title": "...",
    "due": "...",
    "list": "Inbox"
  },
  "request_id": "uuid"
}
```

---

### 5.4 System Bridge 层（系统能力桥）

负责真正“触碰系统/外部服务”。

#### macOS Shortcuts Bridge

* 调用方式：`shortcuts run <name> --input <json>`
* 用于：

  * Reminders
  * Notes
  * Calendar（未来）
  * Files / Focus / Music（未来）

#### Home Assistant Bridge

* REST / WebSocket
* Token 权限最小化
* entity/domain 白名单

---

## 6. 核心 Tool 定义（MVP）

### 6.1 Home Assistant Tool

```json
{
  "type": "ha.call_service",
  "params": {
    "domain": "light",
    "service": "turn_on",
    "entity_id": "light.living_room",
    "data": {"brightness": 128}
  }
}
```

### 6.2 Reminders Tool

```json
{
  "type": "reminder.create",
  "params": {
    "title": "明天九点交房租",
    "due": "2026-01-31T09:00:00+01:00",
    "list": "Inbox"
  }
}
```

### 6.3 Notes Tool

```json
{
  "type": "note.create",
  "params": {
    "folder": "Inbox",
    "title": "随手记",
    "content": "……"
  }
}
```

---

## 7. 技术选型（基于当前约束）

* LLM：llama.cpp + Qwen 4B GGUF Q4_K_M
* STT：whisper.cpp small (multilingual)
* 运行环境：macOS 原生（推理）+ 可选 Docker（业务）
* Shortcut：macOS CLI `shortcuts`
* HA：REST/WebSocket
