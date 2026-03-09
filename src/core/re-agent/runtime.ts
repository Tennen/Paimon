import { isReAgentCommandInput, withReAgentPrefix } from "./command";
import { OllamaReAgentLlmClient, ReAgentLlmClient, ReAgentToolDescriptor } from "./llmClient";
import { createMcpModule } from "./modules/mcpModule";
import { createMultiAgentModule } from "./modules/multiAgentModule";
import { createRagModule } from "./modules/ragModule";
import { ReActObservation, ReAgentModule, ReAgentTraceStep } from "./types";

export type ReAgentRuntimeRunInput = { sessionId: string; input: string; maxSteps?: number };
export type ReAgentRuntimeStopReason = "responded" | "max_steps" | "llm_error";
export type ReAgentRuntimeResult = { response: string; trace: ReAgentTraceStep[]; reason: ReAgentRuntimeStopReason };
export type ReAgentRuntimeOptions = { llmClient?: ReAgentLlmClient; modules?: ReAgentModule[]; maxSteps?: number };

const DEFAULT_MAX_STEPS = 6;

export class ReAgentRuntime {
  private readonly llmClient: ReAgentLlmClient;
  private readonly modules: Map<string, ReAgentModule>;
  private readonly tools: ReAgentToolDescriptor[];
  private readonly maxSteps: number;

  constructor(options: ReAgentRuntimeOptions = {}) {
    const modules = options.modules ?? createDefaultReAgentModules();
    this.llmClient = options.llmClient ?? new OllamaReAgentLlmClient();
    this.modules = new Map(modules.map((item) => [item.name, item]));
    this.tools = modules.map((item) => ({ name: item.name, ...(item.description ? { description: item.description } : {}) }));
    this.maxSteps = readPositiveInt(options.maxSteps, process.env.RE_AGENT_MAX_STEPS, DEFAULT_MAX_STEPS);
  }

  async run(input: ReAgentRuntimeRunInput): Promise<ReAgentRuntimeResult> {
    const sessionId = String(input.sessionId ?? "").trim();
    const userInput = String(input.input ?? "").trim();
    const maxSteps = readPositiveInt(input.maxSteps, undefined, this.maxSteps);
    const trace: ReAgentTraceStep[] = [];

    if (!userInput) return { response: toReResponse("请输入 /re 后的问题内容。"), trace, reason: "responded" };

    for (let step = 1; step <= maxSteps; step += 1) {
      try {
        const action = await this.llmClient.nextAction({ sessionId, input: userInput, step, maxSteps, history: trace, tools: this.tools });
        if (action.kind === "respond") {
          trace.push({ step, action });
          return { response: toReResponse(action.response), trace, reason: "responded" };
        }

        const observation = await this.exec(action.tool, action.action, action.params, {
          sessionId,
          input: userInput,
          step,
          maxSteps,
          history: trace.slice()
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
    context: { sessionId: string; input: string; step: number; maxSteps: number; history: ReAgentTraceStep[] }
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
