import { isReAgentCommandInput, withReAgentPrefix } from "./command";
import { OllamaReAgentLlmClient, ReAgentLlmClient, ReAgentToolDescriptor } from "./llmClient";
import { createMcpModule } from "./modules/mcpModule";
import { createMultiAgentModule } from "./modules/multiAgentModule";
import { createRagModule } from "./modules/ragModule";
import { MemoryStore } from "../../memory/memoryStore";
import { RawMemoryStore } from "../../memory/rawMemoryStore";
import { SummaryMemoryStore } from "../../memory/summaryMemoryStore";
import { SummaryVectorIndex } from "../../memory/summaryVectorIndex";
import { ReActObservation, ReAgentMemoryContext, ReAgentModule, ReAgentTraceStep } from "./types";

export type ReAgentRuntimeRunInput = { sessionId: string; input: string; maxSteps?: number };
export type ReAgentRuntimeStopReason = "responded" | "max_steps" | "llm_error";
export type ReAgentRuntimeResult = { response: string; trace: ReAgentTraceStep[]; reason: ReAgentRuntimeStopReason };
export type ReAgentRuntimeOptions = {
  llmClient?: ReAgentLlmClient;
  modules?: ReAgentModule[];
  maxSteps?: number;
  memoryStore?: MemoryStore;
  rawMemoryStore?: RawMemoryStore;
  summaryMemoryStore?: SummaryMemoryStore;
  summaryVectorIndex?: SummaryVectorIndex;
  summaryTopK?: number;
  rawRefLimit?: number;
  rawRecordLimit?: number;
};

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_SUMMARY_TOP_K = 4;
const DEFAULT_RAW_REF_LIMIT = 8;
const DEFAULT_RAW_RECORD_LIMIT = 3;
const DEFAULT_SUMMARY_TEXT_LIMIT = 380;
const DEFAULT_RAW_TEXT_LIMIT = 260;

export class ReAgentRuntime {
  private readonly llmClient: ReAgentLlmClient;
  private readonly modules: Map<string, ReAgentModule>;
  private readonly tools: ReAgentToolDescriptor[];
  private readonly maxSteps: number;
  private readonly memoryStore: MemoryStore;
  private readonly rawMemoryStore: RawMemoryStore;
  private readonly summaryMemoryStore: SummaryMemoryStore;
  private readonly summaryVectorIndex: SummaryVectorIndex;
  private readonly summaryTopK: number;
  private readonly rawRefLimit: number;
  private readonly rawRecordLimit: number;

  constructor(options: ReAgentRuntimeOptions = {}) {
    const modules = options.modules ?? createDefaultReAgentModules();
    this.llmClient = options.llmClient ?? new OllamaReAgentLlmClient();
    this.modules = new Map(modules.map((item) => [item.name, item]));
    this.tools = modules.map((item) => ({ name: item.name, ...(item.description ? { description: item.description } : {}) }));
    this.maxSteps = readPositiveInt(options.maxSteps, process.env.RE_AGENT_MAX_STEPS, DEFAULT_MAX_STEPS);
    this.memoryStore = options.memoryStore ?? new MemoryStore();
    this.rawMemoryStore = options.rawMemoryStore ?? new RawMemoryStore();
    this.summaryMemoryStore = options.summaryMemoryStore ?? new SummaryMemoryStore();
    this.summaryVectorIndex = options.summaryVectorIndex ?? new SummaryVectorIndex();
    this.summaryTopK = readPositiveInt(options.summaryTopK, process.env.MEMORY_SUMMARY_TOP_K, DEFAULT_SUMMARY_TOP_K);
    this.rawRefLimit = readPositiveInt(options.rawRefLimit, process.env.MEMORY_RAW_REF_LIMIT, DEFAULT_RAW_REF_LIMIT);
    this.rawRecordLimit = readPositiveInt(options.rawRecordLimit, process.env.MEMORY_RAW_RECORD_LIMIT, DEFAULT_RAW_RECORD_LIMIT);
  }

  async run(input: ReAgentRuntimeRunInput): Promise<ReAgentRuntimeResult> {
    const sessionId = String(input.sessionId ?? "").trim();
    const userInput = String(input.input ?? "").trim();
    const maxSteps = readPositiveInt(input.maxSteps, undefined, this.maxSteps);
    const trace: ReAgentTraceStep[] = [];
    const memoryContext = this.buildMemoryContext(sessionId, userInput);

    if (!userInput) return { response: toReResponse("请输入 /re 后的问题内容。"), trace, reason: "responded" };

    for (let step = 1; step <= maxSteps; step += 1) {
      try {
        const action = await this.llmClient.nextAction({
          sessionId,
          input: userInput,
          step,
          maxSteps,
          history: trace,
          tools: this.tools,
          ...(memoryContext ? { memoryContext } : {})
        });
        if (action.kind === "respond") {
          trace.push({ step, action });
          return { response: toReResponse(action.response), trace, reason: "responded" };
        }

        const observation = await this.exec(action.tool, action.action, action.params, {
          sessionId,
          input: userInput,
          step,
          maxSteps,
          history: trace.slice(),
          ...(memoryContext ? { memoryContext } : {})
        });
        trace.push({ step, action, observation });
      } catch (error) {
        return { response: toReResponse(`子 agent 模型调用失败: ${(error as Error).message}`), trace, reason: "llm_error" };
      }
    }

    return { response: toReResponse("达到最大推理步数，请使用 /re 继续。"), trace, reason: "max_steps" };
  }

  private async exec(
    tool: string,
    action: string,
    params: Record<string, unknown>,
    context: { sessionId: string; input: string; step: number; maxSteps: number; history: ReAgentTraceStep[]; memoryContext?: ReAgentMemoryContext }
  ): Promise<ReActObservation> {
    const module = this.modules.get(tool);
    if (!module) return { ok: false, error: `Unknown re-agent module: ${tool}` };
    try {
      const result = await module.execute(action, params, context);
      return { ok: result.ok, ...(result.output !== undefined ? { output: result.output } : {}), ...(result.error ? { error: result.error } : {}) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  resetSession(sessionId: string): void {
    const key = String(sessionId ?? "").trim();
    if (!key) return;
    this.memoryStore.clear(key);
    this.rawMemoryStore.clear(key);
    this.summaryMemoryStore.clear(key);
    this.summaryVectorIndex.clear(key);
  }

  private buildMemoryContext(sessionId: string, query: string): ReAgentMemoryContext | undefined {
    if (!sessionId || !query) return undefined;
    const summaries = this.summaryVectorIndex.search(sessionId, query, this.summaryTopK);
    if (summaries.length === 0) return undefined;
    const rawRefIds = unique(summaries.flatMap((item) => item.rawRefs)).slice(0, this.rawRefLimit);
    const rawRecords = rawRefIds.length > 0
      ? this.rawMemoryStore.getByIds(rawRefIds, sessionId).slice(0, this.rawRecordLimit)
      : [];
    return {
      summaries: summaries.map((item) => ({
        id: item.id,
        text: clip(item.text, DEFAULT_SUMMARY_TEXT_LIMIT),
        score: item.score,
        rawRefs: item.rawRefs.slice(0, this.rawRefLimit),
        updatedAt: item.updatedAt
      })),
      rawRecords: rawRecords.map((item) => ({
        id: item.id,
        requestId: item.requestId,
        source: item.source,
        user: clip(item.user, DEFAULT_RAW_TEXT_LIMIT),
        assistant: clip(item.assistant, DEFAULT_RAW_TEXT_LIMIT),
        createdAt: item.createdAt
      }))
    };
  }
}

export function createDefaultReAgentModules(): ReAgentModule[] {
  return [createRagModule(), createMcpModule(), createMultiAgentModule()];
}

function toReResponse(text: string): string {
  const content = String(text ?? "").trim() || "暂时无法完成该请求。";
  return isReAgentCommandInput(content) ? content : withReAgentPrefix(content);
}

function readPositiveInt(raw: unknown, envRaw: unknown, fallback: number): number {
  for (const value of [raw, envRaw]) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function unique(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function clip(input: string, max: number): string {
  const value = String(input ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}
