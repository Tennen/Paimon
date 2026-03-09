import assert from "node:assert/strict";
import test from "node:test";
import path from "path";
import { Orchestrator } from "./orchestrator";
import { ToolRouter } from "../tools/toolRouter";
import { ToolRegistry } from "../tools/toolRegistry";
import { LLMChatRequest, LLMEngine } from "../engines/llm/llm";
import { SkillManager } from "../skills/skillManager";
import { Envelope, Response, SkillPlanningResult, SkillSelectionResult } from "../types";
import { MemoryStore } from "../memory/memoryStore";
import { ReAgentMemoryStore } from "../memory/reAgentMemoryStore";
import { CallbackDispatcher } from "../integrations/wecom/callbackDispatcher";

class StubSessionMemoryStore {
  public readonly readCalls: string[] = [];
  public readonly appendCalls: Array<{ sessionId: string; entry: string }> = [];

  constructor(private readonly initialMemory: string = "") {}

  read(sessionId: string): string {
    this.readCalls.push(sessionId);
    return this.initialMemory;
  }

  append(sessionId: string, entry: string): void {
    this.appendCalls.push({ sessionId, entry });
  }

  clear(_sessionId: string): void {}
}

class StubLLMEngine implements LLMEngine {
  async chat(_request: LLMChatRequest): Promise<string> {
    return "stub-chat-response";
  }

  async route(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
    return { decision: "respond", response_text: "not-used" };
  }

  async plan(
    _text: string,
    _runtimeContext: Record<string, unknown>
  ): Promise<SkillPlanningResult> {
    return {
      tool: "noop",
      op: "run",
      args: {},
      success_response: "ok",
      failure_response: "fail"
    };
  }

  getModelForStep(): string {
    return "stub-model";
  }

  getProviderName(): "ollama" {
    return "ollama";
  }
}

function createEnvelope(requestId: string, text: string): Envelope {
  return {
    requestId,
    source: "http",
    sessionId: "session-1",
    kind: "text",
    text,
    receivedAt: new Date().toISOString()
  };
}

function createOrchestrator(
  registry: ToolRegistry,
  memoryStore: StubSessionMemoryStore,
  reAgentMemoryStore: StubSessionMemoryStore,
  llmEngine: LLMEngine = new StubLLMEngine()
): Orchestrator {
  const toolRouter = new ToolRouter(registry);
  const skillManager = new SkillManager(path.resolve(process.cwd(), ".orchestrator-reagent-test-skill-missing"));
  const callbackDispatcher = { send: async (_envelope: Envelope, _response: Response) => {} } as CallbackDispatcher;

  return new Orchestrator(
    toolRouter,
    llmEngine,
    memoryStore as unknown as MemoryStore,
    skillManager,
    registry,
    callbackDispatcher,
    reAgentMemoryStore as unknown as ReAgentMemoryStore
  );
}

test("routes /re user input memory to re-agent store", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const reAgentMemoryStore = new StubSessionMemoryStore("re-memory");
  const registry = new ToolRegistry();
  let seenMemory = "";
  registry.registerDirectShortcut({
    command: "/re",
    execute: async (context) => {
      seenMemory = context.memory;
      return { ok: true, output: { text: "普通回复" } };
    }
  });

  const orchestrator = createOrchestrator(registry, memoryStore, reAgentMemoryStore);
  const response = await orchestrator.handle(createEnvelope("req-1", "/re 你好"));

  assert.equal(response.text, "普通回复");
  assert.equal(seenMemory, "re-memory");
  assert.equal(memoryStore.readCalls.length, 0);
  assert.equal(reAgentMemoryStore.readCalls.length, 1);
  assert.equal(memoryStore.appendCalls.length, 0);
  assert.equal(reAgentMemoryStore.appendCalls.length, 1);
});

test("routes /re assistant output memory to re-agent store", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const reAgentMemoryStore = new StubSessionMemoryStore("re-memory");
  const registry = new ToolRegistry();
  let seenMemory = "";
  registry.registerDirectShortcut({
    command: "/ask",
    execute: async (context) => {
      seenMemory = context.memory;
      return { ok: true, output: { text: "/re 子 agent 回复" } };
    }
  });

  const orchestrator = createOrchestrator(registry, memoryStore, reAgentMemoryStore);
  const response = await orchestrator.handle(createEnvelope("req-2", "/ask test"));

  assert.equal(response.text, "/re 子 agent 回复");
  assert.equal(seenMemory, "main-memory");
  assert.equal(memoryStore.readCalls.length, 1);
  assert.equal(reAgentMemoryStore.readCalls.length, 0);
  assert.equal(memoryStore.appendCalls.length, 0);
  assert.equal(reAgentMemoryStore.appendCalls.length, 1);
});

test("routes normal dialogue memory to default memory store", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const reAgentMemoryStore = new StubSessionMemoryStore("re-memory");
  const registry = new ToolRegistry();
  let seenMemory = "";
  registry.registerDirectShortcut({
    command: "/ask",
    execute: async (context) => {
      seenMemory = context.memory;
      return { ok: true, output: { text: "常规回复" } };
    }
  });

  const orchestrator = createOrchestrator(registry, memoryStore, reAgentMemoryStore);
  const response = await orchestrator.handle(createEnvelope("req-3", "/ask test"));

  assert.equal(response.text, "常规回复");
  assert.equal(seenMemory, "main-memory");
  assert.equal(memoryStore.readCalls.length, 1);
  assert.equal(reAgentMemoryStore.readCalls.length, 0);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(reAgentMemoryStore.appendCalls.length, 0);
});

test("supports local planning respond path from routing use_planning", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const reAgentMemoryStore = new StubSessionMemoryStore("re-memory");
  const registry = new ToolRegistry();
  let planningCalled = 0;

  const llmEngine: LLMEngine = {
    async chat(_request: LLMChatRequest): Promise<string> {
      return "stub-chat-response";
    },
    async route(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
      return { decision: "use_planning", planning_thinking_budget: 2048 };
    },
    async plan(
      _text: string,
      _runtimeContext: Record<string, unknown>,
      planningOptions?: { thinkingBudgetOverride?: number }
    ): Promise<SkillPlanningResult> {
      planningCalled += 1;
      assert.equal(planningOptions?.thinkingBudgetOverride, 2048);
      return { decision: "respond", response_text: "本地thinking已完成并直接回复" };
    },
    getModelForStep(): string {
      return "stub-model";
    },
    getProviderName(): "ollama" {
      return "ollama";
    }
  };

  const orchestrator = createOrchestrator(registry, memoryStore, reAgentMemoryStore, llmEngine);
  const response = await orchestrator.handle(createEnvelope("req-4", "解释一下这个数学题"));

  assert.equal(response.text, "本地thinking已完成并直接回复");
  assert.equal(planningCalled, 1);
  assert.equal(memoryStore.readCalls.length, 1);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(reAgentMemoryStore.appendCalls.length, 0);
});
