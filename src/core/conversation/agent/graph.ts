import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { LLMChatMessage } from "../../../engines/llm/llm";
import { ConversationSkillLease } from "../../../memory/conversationWindowStore";
import { Response, ToolExecution } from "../../../types";
import { buildToolObservationText, buildToolResponse, ConversationRuntimeSupport, isLlmMemoryContextEnabled, resolveMemoryDecision } from "../shared";
import { ConversationTurnInput } from "../types";
import {
  AgentFollowupMode,
  AgentLoopAction,
  runAgentLoopAction,
  runBootstrapDecision
} from "./llm";

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

const AgentRuntimeState = Annotation.Root({
  historyMessages: Annotation<LLMChatMessage[]>(),
  text: Annotation<string>(),
  envelope: Annotation<ConversationTurnInput["envelope"]>(),
  start: Annotation<number>(),
  readSessionMemory: Annotation<() => string>(),
  userAt: Annotation<string>(),
  activeLease: Annotation<ConversationSkillLease | null>(),
  selectedSkillName: Annotation<string | null>(),
  objective: Annotation<string>(),
  memory: Annotation<string>(),
  memoryEnabled: Annotation<boolean>(),
  memoryQuery: Annotation<string>(),
  response: Annotation<Response | null>(),
  action: Annotation<AgentLoopAction | null>(),
  trace: Annotation<AgentTraceItem[]>(),
  step: Annotation<number>(),
  lastToolResponse: Annotation<Response | null>(),
  followupMode: Annotation<AgentFollowupMode>(),
  rerouteReason: Annotation<string>()
});

export type AgentRuntimeStateValue = typeof AgentRuntimeState.State;
type AgentRuntimeUpdate = Partial<AgentRuntimeStateValue>;
type AgentRuntimeGraph = {
  invoke(input: AgentRuntimeStateValue, options?: { recursionLimit?: number }): Promise<AgentRuntimeStateValue>;
};
type BootstrapRoute = "load_memory" | "agent" | "finish";
type AgentRoute = "tool" | "reroute_bootstrap" | "finish";
type ToolRoute = "agent" | "finish";

export function buildAgentRuntimeGraph(
  support: ConversationRuntimeSupport,
  maxSteps: number
): AgentRuntimeGraph {
  const graph = new StateGraph(AgentRuntimeState)
    .addNode("bootstrap", createBootstrapNode(support))
    .addNode("loadMemory", createLoadMemoryNode(support))
    .addNode("agent", createAgentNode(support, maxSteps))
    .addNode("tools", createToolNode(support, maxSteps))
    .addNode("rerouteBootstrap", createRerouteBootstrapNode(support))
    .addEdge(START, "bootstrap")
    .addConditionalEdges("bootstrap", routeAfterBootstrap, {
      load_memory: "loadMemory",
      agent: "agent",
      finish: END
    })
    .addEdge("loadMemory", "agent")
    .addConditionalEdges("agent", routeAfterAgent, {
      tool: "tools",
      reroute_bootstrap: "rerouteBootstrap",
      finish: END
    })
    .addConditionalEdges("tools", routeAfterTool, {
      agent: "agent",
      finish: END
    })
    .addConditionalEdges("rerouteBootstrap", routeAfterBootstrap, {
      load_memory: "loadMemory",
      agent: "agent",
      finish: END
    })
    .compile();

  return graph as unknown as AgentRuntimeGraph;
}

function createBootstrapNode(support: ConversationRuntimeSupport): (state: AgentRuntimeStateValue) => Promise<AgentRuntimeUpdate> {
  return async (state) => {
    if (state.activeLease) {
      return {
        selectedSkillName: state.activeLease.skillName,
        objective: state.activeLease.objective ?? "",
        memory: "",
        memoryEnabled: false,
        memoryQuery: "",
        response: null,
        action: null,
        followupMode: "none",
        rerouteReason: ""
      };
    }

    const routingEngine = support.resolveLLMEngine("routing");
    const bootstrap = await runBootstrapDecision({
      engine: routingEngine,
      historyMessages: state.historyMessages,
      text: state.text,
      context: {
        mode: "windowed-agent",
        current_time: buildCurrentTimeContext(),
        skills_context: support.buildRoutingSkillsContext(),
        window: {
          active: state.historyMessages.length > 0,
          turn_count: Math.floor(state.historyMessages.length / 2)
        }
      }
    });
    support.writeLlmAudit(state.envelope, "routing", state.start, routingEngine);
    console.log(
      `[ConversationAgent] session=${state.envelope.sessionId} bootstrap decision=${bootstrap.decision}${bootstrap.decision === "use_skill" ? ` skill=${bootstrap.skill_name}` : ""} history_messages=${state.historyMessages.length}`
    );

    return {
      ...applyBootstrapDecision(bootstrap, state.text),
      activeLease: null
    };
  };
}

function createRerouteBootstrapNode(support: ConversationRuntimeSupport): (state: AgentRuntimeStateValue) => Promise<AgentRuntimeUpdate> {
  return async (state) => {
    const routingEngine = support.resolveLLMEngine("routing");
    const bootstrap = await runBootstrapDecision({
      engine: routingEngine,
      historyMessages: state.historyMessages,
      text: state.text,
      context: {
        mode: "windowed-agent",
        current_time: buildCurrentTimeContext(),
        skills_context: support.buildRoutingSkillsContext(),
        reroute_reason: state.rerouteReason || "agent requested reroute"
      }
    });
    support.writeLlmAudit(state.envelope, "routing", state.start, routingEngine);
    console.log(
      `[ConversationAgent] session=${state.envelope.sessionId} reroute_bootstrap decision=${bootstrap.decision}${bootstrap.decision === "use_skill" ? ` skill=${bootstrap.skill_name}` : ""} history_messages=${state.historyMessages.length}`
    );

    return {
      ...applyBootstrapDecision(bootstrap, state.text),
      activeLease: null
    };
  };
}

function createLoadMemoryNode(support: ConversationRuntimeSupport): (state: AgentRuntimeStateValue) => Promise<AgentRuntimeUpdate> {
  return async (state) => {
    const memory = state.memoryEnabled
      ? support.loadMemoryForNextStep(
          state.envelope.sessionId,
          state.memoryQuery || state.text,
          state.readSessionMemory
        )
      : "";
    return {
      memory,
      memoryEnabled: false,
      memoryQuery: ""
    };
  };
}

function createAgentNode(
  support: ConversationRuntimeSupport,
  maxSteps: number
): (state: AgentRuntimeStateValue) => Promise<AgentRuntimeUpdate> {
  return async (state) => {
    const step = state.step + 1;
    if (step > maxSteps) {
      return buildMaxStepResponse(state);
    }

    const planningEngine = support.resolveLLMEngine("planning");
    const selectedSkillName = state.selectedSkillName ?? undefined;
    const planningContext = support.buildPlanningContext(selectedSkillName);
    const action = await runAgentLoopAction({
      engine: planningEngine,
      historyMessages: state.historyMessages,
      text: state.text,
      context: {
        mode: "windowed-agent",
        current_time: buildCurrentTimeContext(),
        selected_skill: selectedSkillName
          ? {
              name: selectedSkillName,
              objective: state.objective || "",
              detail: planningContext.detail
            }
          : null,
        tools_schema: extractToolsSchema(planningContext.toolContext),
        tools_context: extractToolRuntimeData(planningContext.toolContext),
        ...(state.memory ? { memory: state.memory } : {}),
        agent_state: {
          step,
          max_steps: maxSteps,
          trace: state.trace
        }
      }
    });
    support.writeLlmAudit(state.envelope, "planning", state.start, planningEngine);
    console.log(
      `[ConversationAgent] session=${state.envelope.sessionId} planning_iteration=${step} max_iterations=${maxSteps} decision=${action.decision} selected_skill=${selectedSkillName ?? "-"} history_messages=${state.historyMessages.length} trace_items=${state.trace.length}`
    );

    if (action.decision === "respond") {
      const response: Response = state.lastToolResponse?.data
        ? { text: action.response_text || "OK", data: state.lastToolResponse.data }
        : { text: action.response_text || "OK" };
      return {
        step,
        action,
        response,
        objective: action.objective || state.objective || "",
        followupMode: action.followup_mode ?? "none",
        rerouteReason: ""
      };
    }

    if (action.decision === "reroute") {
      if (!state.activeLease) {
        return {
          step,
          action,
          response: { text: "我先重新理解一下你的目标，请换一种说法再试试。" },
          selectedSkillName: null,
          objective: "",
          followupMode: "none",
          rerouteReason: action.reason ?? ""
        };
      }
      return {
        step,
        action,
        response: null,
        rerouteReason: action.reason ?? ""
      };
    }

    return {
      step,
      action,
      response: null,
      rerouteReason: ""
    };
  };
}

function createToolNode(
  support: ConversationRuntimeSupport,
  maxSteps: number
): (state: AgentRuntimeStateValue) => Promise<AgentRuntimeUpdate> {
  return async (state) => {
    const action = state.action;
    if (!action || action.decision !== "tool_call") {
      return {
        response: { text: "Tool call missing from agent state." },
        followupMode: "none"
      };
    }

    const toolExecution: ToolExecution = {
      tool: action.tool,
      op: action.action,
      args: action.params
    };
    console.log(
      `[ConversationAgent] session=${state.envelope.sessionId} tool_call iteration=${state.step} max_iterations=${maxSteps} tool=${action.tool} action=${action.action}`
    );
    const toolResult = await support.createToolExecutor()(toolExecution, state.memory, state.envelope);
    const lastToolResponse = buildToolResponse(toolResult.result, "", "", true);
    const toolObservationText = buildToolObservationText(toolResult.result);
    console.log(
      `[ConversationAgent] session=${state.envelope.sessionId} tool_result iteration=${state.step} max_iterations=${maxSteps} ok=${toolResult.result.ok} text=${JSON.stringify(toolObservationText)}`
    );

    if (hasVisualResponse(lastToolResponse)) {
      console.log(
        `[ConversationAgent] session=${state.envelope.sessionId} terminal_tool_result iteration=${state.step} max_iterations=${maxSteps} reason=visual_output`
      );
      return {
        lastToolResponse,
        response: lastToolResponse,
        followupMode: "none",
        rerouteReason: ""
      };
    }

    return {
      lastToolResponse,
      response: null,
      trace: [
        ...state.trace,
        {
          step: state.step,
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
        }
      ],
      rerouteReason: ""
    };
  };
}

function applyBootstrapDecision(
  bootstrap: Awaited<ReturnType<typeof runBootstrapDecision>>,
  text: string
): AgentRuntimeUpdate {
  if (bootstrap.decision === "respond") {
    return {
      response: { text: bootstrap.response_text || "OK" },
      selectedSkillName: null,
      objective: "",
      memory: "",
      memoryEnabled: false,
      memoryQuery: "",
      action: null,
      lastToolResponse: null,
      followupMode: "none",
      rerouteReason: ""
    };
  }

  const memoryDecision = resolveMemoryDecision(bootstrap, text);
  return {
    response: null,
    selectedSkillName: bootstrap.decision === "use_skill" ? bootstrap.skill_name : null,
    objective: "",
    memory: "",
    memoryEnabled: isLlmMemoryContextEnabled() && memoryDecision.enabled,
    memoryQuery: memoryDecision.query,
    action: null,
    lastToolResponse: null,
    followupMode: "none",
    rerouteReason: ""
  };
}

function routeAfterBootstrap(state: AgentRuntimeStateValue): BootstrapRoute {
  if (state.response) {
    return "finish";
  }
  if (state.memoryEnabled) {
    return "load_memory";
  }
  return "agent";
}

function routeAfterAgent(state: AgentRuntimeStateValue): AgentRoute {
  if (state.response) {
    return "finish";
  }
  if (state.action?.decision === "tool_call") {
    return "tool";
  }
  if (state.action?.decision === "reroute") {
    return "reroute_bootstrap";
  }
  return "finish";
}

function routeAfterTool(state: AgentRuntimeStateValue): ToolRoute {
  return state.response ? "finish" : "agent";
}

function buildMaxStepResponse(state: AgentRuntimeStateValue): AgentRuntimeUpdate {
  if (state.lastToolResponse) {
    return {
      response: state.lastToolResponse,
      followupMode: "none",
      action: null,
      rerouteReason: ""
    };
  }

  return {
    response: { text: "达到本轮最大推理步数，请换一种说法继续。" },
    followupMode: "none",
    action: null,
    rerouteReason: ""
  };
}

function buildCurrentTimeContext(): { isoTime: string; userTimezone: string } {
  return {
    isoTime: new Date().toISOString(),
    userTimezone: "Asia/Shanghai"
  };
}

function extractToolsSchema(toolsContext: Record<string, Record<string, unknown>> | null): unknown[] {
  const schema = toolsContext?._tools?.schema;
  return Array.isArray(schema) ? schema : [];
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
