import { LLMChatMessage } from "../../../engines/llm/llm";
import { ConversationWindowService } from "../../../memory/conversationWindowService";
import { ConversationSkillLease } from "../../../memory/conversationWindowStore";
import { Response, ToolExecution } from "../../../types";
import { buildToolObservationText, buildToolResponse, buildToolResultResponse, ConversationRuntimeSupport, isLlmMemoryContextEnabled, resolveMemoryDecision } from "../shared";
import { ConversationRuntime, ConversationTurnInput } from "../types";
import {
  AgentFollowupMode,
  runAgentLoopAction,
  runBootstrapDecision
} from "./llm";

const DEFAULT_AGENT_MAX_STEPS = 4;

type AgentTraceItem = {
  step: number;
  action: {
    decision: "tool_call";
    tool: string;
    action: string;
    params: Record<string, unknown>;
  };
  observation: {
    ok: boolean;
    text: string;
  };
};

export class WindowedAgentConversationRuntime implements ConversationRuntime {
  private readonly support: ConversationRuntimeSupport;
  private readonly windowService: ConversationWindowService;
  private readonly maxSteps: number;

  constructor(
    support: ConversationRuntimeSupport,
    windowService: ConversationWindowService,
    options: { maxSteps?: number } = {}
  ) {
    this.support = support;
    this.windowService = windowService;
    this.maxSteps = readPositiveInt(options.maxSteps, process.env.CONVERSATION_AGENT_MAX_STEPS, DEFAULT_AGENT_MAX_STEPS);
  }

  async handleTurn(input: ConversationTurnInput): Promise<Response> {
    const { text, envelope, start, readSessionMemory } = input;
    const userAt = envelope.receivedAt || new Date().toISOString();
    const windowSnapshot = this.windowService.readActive(envelope.sessionId, userAt);
    const historyMessages = windowSnapshot?.messages ?? [];
    const activeLease = windowSnapshot?.activeSkill;

    if (activeLease) {
      console.log(
        `[ConversationAgent] session=${envelope.sessionId} reuse_skill=${activeLease.skillName} followup_mode=${activeLease.followupMode} history_messages=${historyMessages.length}`
      );
    }

    let selectedSkillName = activeLease?.skillName;
    let objective = activeLease?.objective ?? "";
    let memory = "";
    let response: Response | null = null;

    if (!selectedSkillName) {
      const routingEngine = this.support.resolveLLMEngine("routing");
      const bootstrap = await runBootstrapDecision({
        engine: routingEngine,
        historyMessages,
        text,
        context: {
          mode: "windowed-agent",
          current_time: {
            isoTime: new Date().toISOString(),
            userTimezone: "Asia/Shanghai"
          },
          skills_context: this.support.buildRoutingSkillsContext(),
          window: {
            active: Boolean(windowSnapshot),
            turn_count: Math.floor(historyMessages.length / 2)
          }
        }
      });
      this.support.writeLlmAudit(envelope, "routing", start, routingEngine);
      console.log(
        `[ConversationAgent] session=${envelope.sessionId} bootstrap decision=${bootstrap.decision}${bootstrap.decision === "use_skill" ? ` skill=${bootstrap.skill_name}` : ""} history_messages=${historyMessages.length}`
      );

      if (bootstrap.decision === "respond") {
        response = { text: bootstrap.response_text || "OK" };
      } else {
        const memoryDecision = resolveMemoryDecision(bootstrap, text);
        memory = isLlmMemoryContextEnabled() && memoryDecision.enabled
          ? this.support.loadMemoryForNextStep(envelope.sessionId, memoryDecision.query, readSessionMemory)
          : "";
        if (bootstrap.decision === "use_skill") {
          selectedSkillName = bootstrap.skill_name;
        }
      }
    }

    if (!response) {
      const firstAttempt = await this.runAgentTurn({
        historyMessages,
        text,
        envelope,
        start,
        memory,
        selectedSkillName,
        objective
      });

      let finalAttempt = firstAttempt;
      if (firstAttempt.kind === "reroute" && activeLease) {
        const routingEngine = this.support.resolveLLMEngine("routing");
        const bootstrap = await runBootstrapDecision({
          engine: routingEngine,
          historyMessages,
          text,
          context: {
            mode: "windowed-agent",
            current_time: {
              isoTime: new Date().toISOString(),
              userTimezone: "Asia/Shanghai"
            },
            skills_context: this.support.buildRoutingSkillsContext(),
            reroute_reason: firstAttempt.reason || "agent requested reroute"
          }
        });
        this.support.writeLlmAudit(envelope, "routing", start, routingEngine);
        console.log(
          `[ConversationAgent] session=${envelope.sessionId} reroute_bootstrap decision=${bootstrap.decision}${bootstrap.decision === "use_skill" ? ` skill=${bootstrap.skill_name}` : ""} history_messages=${historyMessages.length}`
        );
        if (bootstrap.decision === "respond") {
          finalAttempt = {
            kind: "response",
            response: { text: bootstrap.response_text || "OK" },
            objective: "",
            followupMode: "none"
          };
        } else {
          const memoryDecision = resolveMemoryDecision(bootstrap, text);
          const rerouteMemory = isLlmMemoryContextEnabled() && memoryDecision.enabled
            ? this.support.loadMemoryForNextStep(envelope.sessionId, memoryDecision.query, readSessionMemory)
            : "";
          finalAttempt = await this.runAgentTurn({
            historyMessages,
            text,
            envelope,
            start,
            memory: rerouteMemory,
            selectedSkillName: bootstrap.decision === "use_skill" ? bootstrap.skill_name : undefined,
            objective: ""
          });
        }
      }

      if (finalAttempt.kind === "reroute") {
        response = { text: "我先重新理解一下你的目标，请换一种说法再试试。" };
        selectedSkillName = undefined;
        objective = "";
      } else {
        response = finalAttempt.response;
        selectedSkillName = finalAttempt.selectedSkillName;
        objective = finalAttempt.objective;
        const nextSkillLease = buildSkillLease(selectedSkillName, finalAttempt.followupMode, objective);
        this.windowService.completeTurn({
          sessionId: envelope.sessionId,
          userText: text,
          assistantText: response.text ?? "",
          userAt,
          assistantAt: new Date().toISOString(),
          ...(nextSkillLease ? { activeSkill: nextSkillLease } : {})
        });
        return response;
      }
    }

    this.windowService.completeTurn({
      sessionId: envelope.sessionId,
      userText: text,
      assistantText: response.text ?? "",
      userAt,
      assistantAt: new Date().toISOString()
    });
    return response;
  }

  private async runAgentTurn(input: {
    historyMessages: LLMChatMessage[];
    text: string;
    envelope: ConversationTurnInput["envelope"];
    start: number;
    memory: string;
    selectedSkillName?: string;
    objective: string;
  }): Promise<
    | { kind: "response"; response: Response; selectedSkillName?: string; objective: string; followupMode: AgentFollowupMode }
    | { kind: "reroute"; reason?: string }
  > {
    const planningEngine = this.support.resolveLLMEngine("planning");
    const trace: AgentTraceItem[] = [];
    let lastToolResponse: Response | null = null;

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const planningContext = this.support.buildPlanningContext(input.selectedSkillName);
      const action = await runAgentLoopAction({
        engine: planningEngine,
        historyMessages: input.historyMessages,
        text: input.text,
        context: {
          mode: "windowed-agent",
          current_time: {
            isoTime: new Date().toISOString(),
            userTimezone: "Asia/Shanghai"
          },
          selected_skill: input.selectedSkillName
            ? {
                name: input.selectedSkillName,
                objective: input.objective || "",
                detail: planningContext.detail
              }
            : null,
          tools_schema: Array.isArray(planningContext.toolContext?._tools?.schema)
            ? planningContext.toolContext?._tools?.schema
            : [],
          tools_context: extractToolRuntimeData(planningContext.toolContext),
          ...(input.memory ? { memory: input.memory } : {}),
          agent_state: {
            step,
            max_steps: this.maxSteps,
            trace
          }
        }
      });
      this.support.writeLlmAudit(input.envelope, "planning", input.start, planningEngine);
      console.log(
        `[ConversationAgent] session=${input.envelope.sessionId} planning_iteration=${step} max_iterations=${this.maxSteps} decision=${action.decision} selected_skill=${input.selectedSkillName ?? "-"} history_messages=${input.historyMessages.length} trace_items=${trace.length}`
      );

      if (action.decision === "reroute") {
        return { kind: "reroute", ...(action.reason ? { reason: action.reason } : {}) };
      }

      if (action.decision === "respond") {
        const response: Response = lastToolResponse && lastToolResponse.data
          ? { text: action.response_text || "OK", data: lastToolResponse.data }
          : { text: action.response_text || "OK" };
        return {
          kind: "response",
          response,
          ...(input.selectedSkillName ? { selectedSkillName: input.selectedSkillName } : {}),
          objective: action.objective || input.objective || "",
          followupMode: action.followup_mode ?? "none"
        };
      }

      const toolExecution: ToolExecution = {
        tool: action.tool,
        op: action.action,
        args: action.params
      };
      console.log(
        `[ConversationAgent] session=${input.envelope.sessionId} tool_call iteration=${step} max_iterations=${this.maxSteps} tool=${action.tool} action=${action.action}`
      );
      const toolResult = await this.support.createToolExecutor()(toolExecution, input.memory, input.envelope);
      lastToolResponse = buildToolResponse(toolResult.result, "", "", true);
      const toolObservationText = buildToolObservationText(toolResult.result);
      console.log(
        `[ConversationAgent] session=${input.envelope.sessionId} tool_result iteration=${step} max_iterations=${this.maxSteps} ok=${toolResult.result.ok} text=${JSON.stringify(toolObservationText)}`
      );
      if (hasVisualResponse(lastToolResponse)) {
        console.log(
          `[ConversationAgent] session=${input.envelope.sessionId} terminal_tool_result iteration=${step} max_iterations=${this.maxSteps} reason=visual_output`
        );
        return {
          kind: "response",
          response: lastToolResponse,
          ...(input.selectedSkillName ? { selectedSkillName: input.selectedSkillName } : {}),
          objective: input.objective || "",
          followupMode: "none"
        };
      }
      trace.push({
        step,
        action: {
          decision: "tool_call",
          tool: action.tool,
          action: action.action,
          params: action.params
        },
        observation: {
          ok: toolResult.result.ok,
          text: toolObservationText
        }
      });
    }

    if (lastToolResponse) {
      return {
        kind: "response",
        response: lastToolResponse,
        ...(input.selectedSkillName ? { selectedSkillName: input.selectedSkillName } : {}),
        objective: input.objective || "",
        followupMode: "none"
      };
    }

    return {
      kind: "response",
      response: { text: "达到本轮最大推理步数，请换一种说法继续。" },
      ...(input.selectedSkillName ? { selectedSkillName: input.selectedSkillName } : {}),
      objective: input.objective || "",
      followupMode: "none"
    };
  }
}

function buildSkillLease(
  selectedSkillName: string | undefined,
  followupMode: AgentFollowupMode,
  objective: string
): ConversationSkillLease | undefined {
  if (!selectedSkillName) {
    return undefined;
  }
  if (followupMode !== "awaiting_user" && followupMode !== "continue_same_skill") {
    return undefined;
  }
  return {
    skillName: selectedSkillName,
    ...(objective ? { objective } : {}),
    followupMode
  };
}

function extractToolRuntimeData(toolsContext: Record<string, Record<string, unknown>> | null): Record<string, unknown> | null {
  if (!toolsContext) {
    return null;
  }
  const entries = Object.entries(toolsContext).filter(([name]) => name !== "_tools");
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function hasVisualResponse(response: Response | null): boolean {
  if (!response?.data || typeof response.data !== "object") {
    return false;
  }
  const data = response.data as Record<string, unknown>;
  return Boolean(data.image) || (Array.isArray(data.images) && data.images.length > 0);
}

function readPositiveInt(raw: unknown, envRaw: unknown, fallback: number): number {
  for (const value of [raw, envRaw]) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}
