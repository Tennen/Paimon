import assert from "node:assert/strict";
import test from "node:test";
import path from "path";
import { LLMChatRequest, LLMEngine, LLMExecutionStep } from "../../../engines/llm/llm";
import { HybridMemoryService } from "../../../memory/hybridMemoryService";
import { RawMemoryStore } from "../../../memory/rawMemoryStore";
import { ConversationWindowService } from "../../../memory/conversationWindowService";
import { SkillManager } from "../../../skills/skillManager";
import { ToolRegistry } from "../../../tools/toolRegistry";
import { ToolRouter } from "../../../tools/toolRouter";
import { Envelope, SkillPlanningResult, SkillSelectionResult } from "../../../types";
import { ConversationRuntimeSupport } from "../shared";
import { WindowedAgentConversationRuntime } from "./runtime";

class QueueChatEngine implements LLMEngine {
  public readonly requests: LLMChatRequest[] = [];

  constructor(private readonly replies: string[]) {}

  async chat(request: LLMChatRequest): Promise<string> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (reply === undefined) {
      throw new Error(`missing queued chat reply for step=${request.step ?? "general"}`);
    }
    return reply;
  }

  async route(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
    return { decision: "respond", response_text: "not-used" };
  }

  async plan(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillPlanningResult> {
    return { decision: "respond", response_text: "not-used" };
  }

  getModelForStep(_step: LLMExecutionStep): string {
    return "queue-model";
  }

  getProviderName(): "ollama" {
    return "ollama";
  }
}

function createRuntime(engine: LLMEngine, registry: ToolRegistry, windowService: ConversationWindowService): WindowedAgentConversationRuntime {
  const support = new ConversationRuntimeSupport({
    toolRouter: new ToolRouter(registry),
    defaultLLMEngine: engine,
    skillManager: new SkillManager(path.resolve(process.cwd(), ".agent-runtime-test-skills-missing")),
    toolRegistry: registry,
    hybridMemoryService: new HybridMemoryService({ rawStore: new RawMemoryStore() }),
    writeLlmAudit: () => {}
  });
  return new WindowedAgentConversationRuntime(support, windowService, { maxSteps: 4 });
}

function createEnvelope(requestId: string, text: string, sessionId: string): Envelope {
  return {
    requestId,
    source: "http",
    sessionId,
    kind: "text",
    text,
    receivedAt: new Date().toISOString()
  };
}

test("windowed agent executes tool loop through LangGraph runtime", async () => {
  const sessionId = `agent-graph-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const windowService = new ConversationWindowService();
  const registry = new ToolRegistry();
  let seenArgs: Record<string, unknown> | null = null;

  registry.register(
    {
      name: "homeassistant",
      execute: async (_op, args, context) => {
        seenArgs = args;
        assert.equal(context.sessionId, sessionId);
        return { ok: true, output: { text: "Lamp is on" } };
      }
    },
    {
      name: "homeassistant",
      description: "Test Home Assistant",
      operations: [
        {
          op: "get_state",
          params: { entity_id: "string" }
        }
      ]
    }
  );

  const engine = new QueueChatEngine([
    '{"decision":"use_skill","skill_name":"homeassistant","memory_mode":"off"}',
    '{"decision":"tool_call","tool":"homeassistant","action":"get_state","params":{"entity_id":"light.desk"}}',
    '{"decision":"respond","response_text":"台灯是打开的","followup_mode":"none"}'
  ]);
  const runtime = createRuntime(engine, registry, windowService);

  try {
    const response = await runtime.handleTurn({
      text: "看一下台灯状态",
      envelope: createEnvelope("req-agent-tool", "看一下台灯状态", sessionId),
      start: Date.now(),
      readSessionMemory: () => "unused-memory"
    });

    assert.equal(response.text, "台灯是打开的");
    assert.deepEqual(seenArgs, { entity_id: "light.desk" });
    assert.deepEqual(engine.requests.map((item) => item.step), ["routing", "planning", "planning"]);
    assert.equal(windowService.readActive(sessionId)?.activeSkill, undefined);
  } finally {
    windowService.clear(sessionId);
  }
});

test("windowed agent reuses active skill lease without rerouting", async () => {
  const sessionId = `agent-graph-lease-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const windowService = new ConversationWindowService();
  const registry = new ToolRegistry();
  registry.register(
    {
      name: "homeassistant",
      execute: async () => ({ ok: true, output: { text: "unused" } })
    },
    {
      name: "homeassistant",
      description: "Test Home Assistant",
      operations: [{ op: "get_state", params: { entity_id: "string" } }]
    }
  );

  const engine = new QueueChatEngine([
    '{"decision":"use_skill","skill_name":"homeassistant","memory_mode":"off"}',
    '{"decision":"respond","response_text":"需要继续确认","followup_mode":"awaiting_user","objective":"control light"}',
    '{"decision":"respond","response_text":"继续使用灯控技能","followup_mode":"none"}'
  ]);
  const runtime = createRuntime(engine, registry, windowService);

  try {
    const firstResponse = await runtime.handleTurn({
      text: "帮我调灯",
      envelope: createEnvelope("req-agent-lease-1", "帮我调灯", sessionId),
      start: Date.now(),
      readSessionMemory: () => ""
    });
    assert.equal(firstResponse.text, "需要继续确认");
    assert.deepEqual(windowService.readActive(sessionId)?.activeSkill, {
      skillName: "homeassistant",
      objective: "control light",
      followupMode: "awaiting_user"
    });

    const secondResponse = await runtime.handleTurn({
      text: "继续",
      envelope: createEnvelope("req-agent-lease-2", "继续", sessionId),
      start: Date.now(),
      readSessionMemory: () => ""
    });

    assert.equal(secondResponse.text, "继续使用灯控技能");
    assert.deepEqual(engine.requests.map((item) => item.step), ["routing", "planning", "planning"]);
  } finally {
    windowService.clear(sessionId);
  }
});

test("windowed agent reroutes active lease once before falling back", async () => {
  const sessionId = `agent-graph-reroute-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const windowService = new ConversationWindowService();
  const registry = new ToolRegistry();
  registry.register(
    {
      name: "homeassistant",
      execute: async () => ({ ok: true, output: { text: "unused" } })
    },
    {
      name: "homeassistant",
      description: "Test Home Assistant",
      operations: [{ op: "get_state", params: { entity_id: "string" } }]
    }
  );

  windowService.completeTurn({
    sessionId,
    userText: "上一轮",
    assistantText: "等待确认",
    userAt: new Date().toISOString(),
    assistantAt: new Date().toISOString(),
    activeSkill: {
      skillName: "homeassistant",
      followupMode: "awaiting_user"
    }
  });

  const engine = new QueueChatEngine([
    '{"decision":"reroute","reason":"not a homeassistant request"}',
    '{"decision":"use_planning","memory_mode":"off"}',
    '{"decision":"reroute","reason":"still unclear"}'
  ]);
  const runtime = createRuntime(engine, registry, windowService);

  try {
    const response = await runtime.handleTurn({
      text: "换个问题",
      envelope: createEnvelope("req-agent-reroute", "换个问题", sessionId),
      start: Date.now(),
      readSessionMemory: () => ""
    });

    assert.equal(response.text, "我先重新理解一下你的目标，请换一种说法再试试。");
    assert.deepEqual(engine.requests.map((item) => item.step), ["planning", "routing", "planning"]);
  } finally {
    windowService.clear(sessionId);
  }
});
