import assert from "node:assert/strict";
import test from "node:test";
import path from "path";
import { Orchestrator } from "./orchestrator";
import { ToolRouter } from "../tools/toolRouter";
import { ToolRegistry } from "../tools/toolRegistry";
import { LLMChatRequest, LLMEngine, LLMExecutionStep } from "../engines/llm/llm";
import { SkillManager } from "../skills/skillManager";
import { Envelope, Response, SkillPlanningResult, SkillSelectionResult } from "../types";
import { MemoryStore } from "../memory/memoryStore";
import { RawMemoryAppendInput, RawMemoryStore } from "../memory/rawMemoryStore";
import { MemoryCompactor, MemoryCompactorInput } from "../memory/memoryCompactor";
import { SummaryMemoryStore } from "../memory/summaryMemoryStore";
import { SummaryVectorIndex } from "../memory/summaryVectorIndex";
import { CallbackDispatcher } from "../integrations/wecom/callbackDispatcher";
import { ObservableMenuService } from "../observable/menuService";
import { buildWeComClickEventEnvelope } from "../integrations/wecom/eventEnvelope";
import { ResolvedDirectInputMapping } from "../config/directInputMappingService";

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

class StubRawMemoryStore {
  public readonly appendCalls: RawMemoryAppendInput[] = [];

  append(input: RawMemoryAppendInput): void {
    this.appendCalls.push({ ...input, meta: input.meta ? { ...input.meta } : {} });
  }
}

class StubMemoryCompactor {
  public readonly maybeCompactCalls: MemoryCompactorInput[] = [];

  async maybeCompact(input: MemoryCompactorInput): Promise<{
    sessionId: string;
    compacted: boolean;
    forced: boolean;
    reason: "threshold_not_met";
    pendingCount: number;
    batchCount: number;
    rawIds: string[];
    usedFallback: boolean;
  }> {
    this.maybeCompactCalls.push({ ...input, ...(input.meta ? { meta: { ...input.meta } } : {}) });
    return {
      sessionId: input.sessionId,
      compacted: false,
      forced: false,
      reason: "threshold_not_met",
      pendingCount: 1,
      batchCount: 0,
      rawIds: [],
      usedFallback: false
    };
  }
}

class StubLLMEngine implements LLMEngine {
  async chat(_request: LLMChatRequest): Promise<string> {
    return "stub-chat-response";
  }

  async route(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
    return { decision: "respond", response_text: "not-used" };
  }

  async selectSkill(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
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

  getModelForStep(_step: LLMExecutionStep): string {
    return "stub-model";
  }

  getProviderName(): "ollama" {
    return "ollama";
  }
}

function createEnvelope(requestId: string, text: string, sessionId: string = "session-1"): Envelope {
  return {
    requestId,
    source: "http",
    sessionId,
    kind: "text",
    text,
    receivedAt: new Date().toISOString()
  };
}

function createToken(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createOrchestrator(
  registry: ToolRegistry,
  memoryStore: StubSessionMemoryStore,
  rawMemoryStore: StubRawMemoryStore | RawMemoryStore = new StubRawMemoryStore(),
  memoryCompactor: StubMemoryCompactor = new StubMemoryCompactor(),
  llmEngine: LLMEngine = new StubLLMEngine(),
  observableMenuService?: Pick<ObservableMenuService, "handleWeComClickEvent" | "markEventDispatchFailed">,
  directInputResolver?: { resolveInput: (input: string) => ResolvedDirectInputMapping | null }
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
    rawMemoryStore as unknown as RawMemoryStore,
    memoryCompactor as unknown as MemoryCompactor,
    undefined,
    undefined,
    observableMenuService,
    directInputResolver
  );
}

test("routes direct shortcut input to shared memory and global raw memory", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const rawMemoryStore = new StubRawMemoryStore();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();
  let seenMemory = "";
  registry.registerDirectShortcut({
    command: "/ask",
    execute: async (context) => {
      seenMemory = context.memory;
      return { ok: true, output: { text: "普通回复" } };
    }
  });

  const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor);
  const response = await orchestrator.handle(createEnvelope("req-1", "/ask 你好"));

  assert.equal(response.text, "普通回复");
  assert.equal(seenMemory, "main-memory");
  assert.equal(memoryStore.readCalls.length, 1);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(rawMemoryStore.appendCalls.length, 1);
  assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
});

test("routes direct shortcut assistant output to shared memory and global raw memory", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const rawMemoryStore = new StubRawMemoryStore();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();
  let seenMemory = "";
  registry.registerDirectShortcut({
    command: "/ask",
    execute: async (context) => {
      seenMemory = context.memory;
      return { ok: true, output: { text: "/followup 回复" } };
    }
  });

  const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor);
  const response = await orchestrator.handle(createEnvelope("req-2", "/ask test"));

  assert.equal(response.text, "/followup 回复");
  assert.equal(seenMemory, "main-memory");
  assert.equal(memoryStore.readCalls.length, 1);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(rawMemoryStore.appendCalls.length, 1);
  assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
});

test("routes normal dialogue memory to shared memory and global raw memory", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const rawMemoryStore = new StubRawMemoryStore();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();
  let seenMemory = "";
  registry.registerDirectShortcut({
    command: "/ask",
    execute: async (context) => {
      seenMemory = context.memory;
      return { ok: true, output: { text: "常规回复" } };
    }
  });

  const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor);
  const response = await orchestrator.handle(createEnvelope("req-3", "/ask test"));

  assert.equal(response.text, "常规回复");
  assert.equal(seenMemory, "main-memory");
  assert.equal(memoryStore.readCalls.length, 1);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(rawMemoryStore.appendCalls.length, 1);
  assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
});

test("maps configured text to direct tool call while keeping original memory text", async () => {
  const memoryStore = new StubSessionMemoryStore("mapped-memory");
  const rawMemoryStore = new StubRawMemoryStore();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();
  let seenInput = "";
  registry.register({
    name: "skill.market-analysis",
    execute: async (_op, args) => {
      seenInput = String(args.input ?? "");
      return {
        ok: true,
        output: {
          text: `handled:${seenInput}`
        }
      };
    }
  });
  registry.registerDirectToolCall({
    command: "/market",
    tool: "skill.market-analysis",
    op: "execute",
    argName: "input",
    argMode: "full_input",
    preferToolResult: true
  });

  const orchestrator = createOrchestrator(
    registry,
    memoryStore,
    rawMemoryStore,
    memoryCompactor,
    new StubLLMEngine(),
    undefined,
    {
      resolveInput: (input: string) => {
        if (input !== "开盘分析") {
          return null;
        }
        return {
          ruleId: "market-open",
          pattern: "开盘分析",
          matchMode: "exact",
          targetText: "/market open"
        };
      }
    }
  );

  const response = await orchestrator.handle(createEnvelope("req-mapped", "开盘分析"));

  assert.equal(response.text, "handled:/market open");
  assert.equal(seenInput, "/market open");
  assert.match(memoryStore.appendCalls[0]?.entry ?? "", /user: 开盘分析/);
  assert.equal(rawMemoryStore.appendCalls[0]?.user, "开盘分析");
});

test("supports local planning respond path from routing use_planning", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const rawMemoryStore = new StubRawMemoryStore();
  const memoryCompactor = new StubMemoryCompactor();
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

  const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor, llmEngine);
  const response = await orchestrator.handle(createEnvelope("req-4", "解释一下这个数学题"));

  assert.equal(response.text, "本地thinking已完成并直接回复");
  assert.equal(planningCalled, 1);
  assert.equal(memoryStore.readCalls.length, 1);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(rawMemoryStore.appendCalls.length, 1);
  assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
});

test("converts WeCom click events to configured dispatch text inside orchestrator", async () => {
  const memoryStore = new StubSessionMemoryStore("menu-memory");
  const registry = new ToolRegistry();
  let seenInput = "";
  registry.registerDirectShortcut({
    command: "/market",
    execute: async (context) => {
      seenInput = context.input;
      return { ok: true, output: { text: `handled:${context.input}` } };
    }
  });

  let markFailedCalls = 0;
  const observableMenuService = {
    handleWeComClickEvent: () => ({
      event: {
        id: "menu-event-1",
        source: "wecom" as const,
        eventType: "click" as const,
        eventKey: "market-close",
        fromUser: "zhangsan",
        toUser: "wwcorp",
        dispatchText: "/market close",
        status: "dispatched" as const,
        receivedAt: new Date().toISOString()
      },
      dispatchText: "/market close",
      replyText: ""
    }),
    markEventDispatchFailed: () => {
      markFailedCalls += 1;
    }
  };

  const orchestrator = createOrchestrator(
    registry,
    memoryStore,
    new StubRawMemoryStore(),
    new StubMemoryCompactor(),
    new StubLLMEngine(),
    observableMenuService
  );

  const response = await orchestrator.handle(
    buildWeComClickEventEnvelope({
      requestId: "wecom-event-1",
      fromUser: "zhangsan",
      toUser: "wwcorp",
      eventKey: "market-close",
      receivedAt: new Date().toISOString()
    })
  );

  assert.equal(response.text, "handled:/market close");
  assert.equal(seenInput, "/market close");
  assert.equal(markFailedCalls, 0);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.match(memoryStore.appendCalls[0]?.entry ?? "", /\/market close/);
});

test("returns menu reply directly when WeCom click event has no dispatch text", async () => {
  const memoryStore = new StubSessionMemoryStore("menu-memory");
  const registry = new ToolRegistry();
  let directCalls = 0;
  registry.registerDirectShortcut({
    command: "/market",
    execute: async () => {
      directCalls += 1;
      return { ok: true, output: { text: "unexpected" } };
    }
  });

  const observableMenuService = {
    handleWeComClickEvent: () => ({
      event: {
        id: "menu-event-2",
        source: "wecom" as const,
        eventType: "click" as const,
        eventKey: "status-only",
        fromUser: "zhangsan",
        toUser: "wwcorp",
        status: "recorded" as const,
        receivedAt: new Date().toISOString()
      },
      dispatchText: "",
      replyText: "已收到菜单事件：状态"
    }),
    markEventDispatchFailed: () => {}
  };

  const orchestrator = createOrchestrator(
    registry,
    memoryStore,
    new StubRawMemoryStore(),
    new StubMemoryCompactor(),
    new StubLLMEngine(),
    observableMenuService
  );

  const response = await orchestrator.handle(
    buildWeComClickEventEnvelope({
      requestId: "wecom-event-2",
      fromUser: "zhangsan",
      toUser: "wwcorp",
      eventKey: "status-only",
      receivedAt: new Date().toISOString()
    })
  );

  assert.equal(response.text, "已收到菜单事件：状态");
  assert.equal(directCalls, 0);
  assert.equal(memoryStore.appendCalls.length, 0);
});

test("routing memory_mode=off skips session memory loading for planning", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const rawMemoryStore = new StubRawMemoryStore();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();

  const llmEngine: LLMEngine = {
    async chat(_request: LLMChatRequest): Promise<string> {
      return "stub-chat-response";
    },
    async route(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
      return {
        decision: "use_planning",
        planning_thinking_budget: 512,
        memory_mode: "off"
      };
    },
    async plan(
      _text: string,
      runtimeContext: Record<string, unknown>,
      planningOptions?: { thinkingBudgetOverride?: number }
    ): Promise<SkillPlanningResult> {
      assert.equal(runtimeContext.memory, undefined);
      assert.equal(planningOptions?.thinkingBudgetOverride, 512);
      return { decision: "respond", response_text: "不需要记忆也能回答" };
    },
    getModelForStep(): string {
      return "stub-model";
    },
    getProviderName(): "ollama" {
      return "ollama";
    }
  };

  const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor, llmEngine);
  const response = await orchestrator.handle(createEnvelope("req-4b", "介绍一下今天的天气"));

  assert.equal(response.text, "不需要记忆也能回答");
  assert.equal(memoryStore.readCalls.length, 0);
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(rawMemoryStore.appendCalls.length, 1);
  assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
});

test("routing memory_mode=on + memory_query injects summary hit and raw replay into planning memory", { concurrency: false }, async () => {
  const token = createToken();
  const sessionId = `session-hybrid-hit-${token}`;
  const memoryStore = new StubSessionMemoryStore("main-memory-fallback");
  const rawMemoryStore = new RawMemoryStore();
  const summaryStore = new SummaryMemoryStore();
  const summaryIndex = new SummaryVectorIndex();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();
  const summaryId = `summary-${token}`;
  const rawId1 = `raw-${token}-1`;
  const rawId2 = `raw-${token}-2`;

  try {
    rawMemoryStore.clear(sessionId);
    summaryStore.clear(sessionId);
    summaryIndex.clear(sessionId);

    rawMemoryStore.append({
      id: rawId1,
      sessionId,
      requestId: `req-${token}-1`,
      source: "http",
      user: "上周项目周报需要发给团队",
      assistant: "周报已发送给团队",
      meta: {}
    });
    rawMemoryStore.append({
      id: rawId2,
      sessionId,
      requestId: `req-${token}-2`,
      source: "http",
      user: "我更喜欢中文总结",
      assistant: "已记住你偏好中文总结",
      meta: {}
    });
    summaryStore.upsert({
      id: summaryId,
      sessionId,
      task_results: ["上周项目周报已发送给团队"],
      long_term_preferences: ["偏好中文总结"],
      rawRefs: [rawId1, rawId2]
    });
    summaryIndex.upsert({
      id: summaryId,
      sessionId,
      text: "上周项目周报已发送给团队 偏好中文总结",
      rawRefs: [rawId1, rawId2]
    });

    const llmEngine: LLMEngine = {
      async chat(_request: LLMChatRequest): Promise<string> {
        return "stub-chat-response";
      },
      async route(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
        return {
          decision: "use_planning",
          memory_mode: "on",
          memory_query: "上周周报发给谁了"
        };
      },
      async plan(
        _text: string,
        runtimeContext: Record<string, unknown>
      ): Promise<SkillPlanningResult> {
        const memory = String(runtimeContext.memory ?? "");
        assert.notEqual(memory, "main-memory-fallback");
        assert.match(memory, /上周项目周报已发送给团队/);
        assert.match(memory, /偏好中文总结/);
        assert.match(memory, /上周项目周报需要发给团队/);
        assert.match(memory, /周报已发送给团队/);
        return { decision: "respond", response_text: "已使用检索记忆" };
      },
      getModelForStep(): string {
        return "stub-model";
      },
      getProviderName(): "ollama" {
        return "ollama";
      }
    };

    const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor, llmEngine);
    const response = await orchestrator.handle(createEnvelope("req-4c", "继续上个任务", sessionId));

    assert.equal(response.text, "已使用检索记忆");
    assert.equal(memoryStore.appendCalls.length, 1);
    assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
  } finally {
    rawMemoryStore.clear(sessionId);
    summaryStore.clear(sessionId);
    summaryIndex.clear(sessionId);
  }
});

test("routing memory_mode=on falls back to session memory when summary query misses", { concurrency: false }, async () => {
  const token = createToken();
  const sessionId = `session-hybrid-miss-${token}`;
  const memoryStore = new StubSessionMemoryStore("main-memory-fallback");
  const rawMemoryStore = new RawMemoryStore();
  const summaryStore = new SummaryMemoryStore();
  const summaryIndex = new SummaryVectorIndex();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();

  try {
    rawMemoryStore.clear(sessionId);
    summaryStore.clear(sessionId);
    summaryIndex.clear(sessionId);

    const llmEngine: LLMEngine = {
      async chat(_request: LLMChatRequest): Promise<string> {
        return "stub-chat-response";
      },
      async route(_text: string, _runtimeContext: Record<string, unknown>): Promise<SkillSelectionResult> {
        return {
          decision: "use_planning",
          memory_mode: "on",
          memory_query: "不存在的历史偏好"
        };
      },
      async plan(
        _text: string,
        runtimeContext: Record<string, unknown>
      ): Promise<SkillPlanningResult> {
        assert.equal(runtimeContext.memory, "main-memory-fallback");
        return { decision: "respond", response_text: "已回退到会话记忆" };
      },
      getModelForStep(): string {
        return "stub-model";
      },
      getProviderName(): "ollama" {
        return "ollama";
      }
    };

    const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor, llmEngine);
    const response = await orchestrator.handle(createEnvelope("req-4d", "继续上个任务", sessionId));

    assert.equal(response.text, "已回退到会话记忆");
    assert.equal(memoryStore.readCalls.length, 1);
    assert.equal(memoryStore.appendCalls.length, 1);
    assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
  } finally {
    rawMemoryStore.clear(sessionId);
    summaryStore.clear(sessionId);
    summaryIndex.clear(sessionId);
  }
});

test("direct shortcut reset-like command still appends shared/global memory", async () => {
  const memoryStore = new StubSessionMemoryStore("main-memory");
  const rawMemoryStore = new StubRawMemoryStore();
  const memoryCompactor = new StubMemoryCompactor();
  const registry = new ToolRegistry();
  registry.registerDirectShortcut({
    command: "/reset",
    execute: async () => ({ ok: true, output: { text: "会话记忆已重置。" } })
  });

  const orchestrator = createOrchestrator(registry, memoryStore, rawMemoryStore, memoryCompactor);
  const response = await orchestrator.handle(createEnvelope("req-5", "/reset"));

  assert.equal(response.text, "会话记忆已重置。");
  assert.equal(memoryStore.appendCalls.length, 1);
  assert.equal(rawMemoryStore.appendCalls.length, 1);
  assert.equal(memoryCompactor.maybeCompactCalls.length, 1);
});
