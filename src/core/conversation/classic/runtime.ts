import { LLMRuntimeContext } from "../../../engines/llm/llm";
import { ToolExecution } from "../../../types";
import { ConversationRuntime, ConversationTurnInput } from "../types";
import {
  buildReadablePlanningMemory,
  buildToolResponse,
  ConversationRuntimeSupport,
  isLlmMemoryContextEnabled,
  resolveMemoryDecision
} from "../shared";

export class ClassicConversationRuntime implements ConversationRuntime {
  private readonly support: ConversationRuntimeSupport;

  constructor(support: ConversationRuntimeSupport) {
    this.support = support;
  }

  async handleTurn(input: ConversationTurnInput) {
    const { text, envelope, start, readSessionMemory } = input;
    const llmEngine = this.support.resolveLLMEngine("routing");
    const routingContext: LLMRuntimeContext = {
      isoTime: new Date().toISOString(),
      userTimezone: "Asia/Shanghai",
      skills_context: this.support.buildRoutingSkillsContext()
    };

    const routingResult = await llmEngine.route(text, routingContext);
    this.support.writeLlmAudit(envelope, "routing", start, llmEngine);

    const memoryDecision = resolveMemoryDecision(routingResult, text);
    const memory = isLlmMemoryContextEnabled() && memoryDecision.enabled
      ? this.support.loadMemoryForNextStep(envelope.sessionId, memoryDecision.query, readSessionMemory)
      : "";

    if (routingResult.decision === "respond") {
      return { text: routingResult.response_text || "OK" };
    }

    const planningEngine = this.support.resolveLLMEngine("planning");
    const planningContext = this.support.buildPlanningContext(routingResult.decision === "use_skill" ? routingResult.skill_name : undefined);
    const runtimeContext: Record<string, unknown> = buildReadablePlanningMemory({
      isoTime: new Date().toISOString(),
      userTimezone: "Asia/Shanghai",
      tools_context: planningContext.toolContext,
      skill_detail: planningContext.detail,
      planning_mode: routingResult.decision === "use_skill" ? "skill_tool_planning" : "local_thinking",
      skill_contract: planningContext.selectedSkill?.tool
        ? {
            tool: planningContext.selectedSkill.tool,
            action: planningContext.selectedSkill.action ?? "execute",
            params: planningContext.selectedSkill.params ?? ["input"]
          }
        : null
    }, memory);

    const plan = await planningEngine.plan(
      text,
      runtimeContext,
      routingResult.planning_thinking_budget === undefined
        ? undefined
        : { thinkingBudgetOverride: routingResult.planning_thinking_budget }
    );
    this.support.writeLlmAudit(envelope, "planning", start, planningEngine);

    if (plan.decision === "respond") {
      return { text: plan.response_text || "OK" };
    }

    const toolExecution: ToolExecution = {
      tool: plan.tool,
      op: plan.op,
      args: plan.args
    };
    const toolResult = await this.support.createToolExecutor()(toolExecution, memory, envelope);
    return buildToolResponse(
      toolResult.result,
      plan.success_response,
      plan.failure_response,
      planningContext.selectedSkill?.preferToolResult ?? false
    );
  }
}
