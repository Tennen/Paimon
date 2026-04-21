import { ConversationWindowService } from "../../../memory/conversationWindowService";
import { ConversationSkillLease } from "../../../memory/conversationWindowStore";
import { Response } from "../../../types";
import { ConversationRuntimeSupport } from "../shared";
import { ConversationRuntime, ConversationTurnInput } from "../types";
import { AgentFollowupMode } from "./llm";
import { AgentRuntimeStateValue, buildAgentRuntimeGraph } from "./graph";

const DEFAULT_AGENT_MAX_STEPS = 4;

export class WindowedAgentConversationRuntime implements ConversationRuntime {
  private readonly support: ConversationRuntimeSupport;
  private readonly windowService: ConversationWindowService;
  private readonly maxSteps: number;
  private readonly graph: ReturnType<typeof buildAgentRuntimeGraph>;

  constructor(
    support: ConversationRuntimeSupport,
    windowService: ConversationWindowService,
    options: { maxSteps?: number } = {}
  ) {
    this.support = support;
    this.windowService = windowService;
    this.maxSteps = readPositiveInt(options.maxSteps, process.env.CONVERSATION_AGENT_MAX_STEPS, DEFAULT_AGENT_MAX_STEPS);
    this.graph = buildAgentRuntimeGraph(this.support, this.maxSteps);
  }

  async handleTurn(input: ConversationTurnInput): Promise<Response> {
    const { text, envelope, start, readSessionMemory } = input;
    const userAt = envelope.receivedAt || new Date().toISOString();
    const windowSnapshot = this.windowService.readActive(envelope.sessionId, userAt);
    const historyMessages = windowSnapshot?.messages ?? [];
    const activeLease = windowSnapshot?.activeSkill ?? null;

    if (activeLease) {
      console.log(
        `[ConversationAgent] session=${envelope.sessionId} reuse_skill=${activeLease.skillName} followup_mode=${activeLease.followupMode} history_messages=${historyMessages.length}`
      );
    }

    const initialState: AgentRuntimeStateValue = {
      historyMessages,
      text,
      envelope,
      start,
      readSessionMemory,
      userAt,
      activeLease,
      selectedSkillName: activeLease?.skillName ?? null,
      objective: activeLease?.objective ?? "",
      memory: "",
      memoryEnabled: false,
      memoryQuery: "",
      response: null,
      action: null,
      trace: [],
      step: 0,
      lastToolResponse: null,
      followupMode: "none",
      rerouteReason: ""
    };

    const finalState = await this.graph.invoke(initialState, {
      recursionLimit: this.maxSteps * 4 + 12
    });
    const response = finalState.response ?? { text: "OK" };
    const nextSkillLease = buildSkillLease(
      finalState.selectedSkillName ?? undefined,
      finalState.followupMode,
      finalState.objective
    );

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

function readPositiveInt(raw: unknown, envRaw: unknown, fallback: number): number {
  for (const value of [raw, envRaw]) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}
