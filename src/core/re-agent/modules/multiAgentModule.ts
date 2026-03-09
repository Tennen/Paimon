import { MultiAgentService } from "../../../integrations/multiagent/service";
import { ReAgentModule } from "../types";

export const MULTI_AGENT_MODULE_NAME = "multiagent";
export const MULTI_AGENT_COLLABORATE_ACTION = "collaborate";

export const MULTI_AGENT_REACT_TOOL_TABLE = [
  {
    tool: MULTI_AGENT_MODULE_NAME,
    action: MULTI_AGENT_COLLABORATE_ACTION,
    description: "Planner/Critic dual-role collaboration for task planning.",
    params: ["goal", "context"]
  }
] as const;

export function createMultiAgentModule(
  service: MultiAgentService = new MultiAgentService()
): ReAgentModule {
  return {
    name: MULTI_AGENT_MODULE_NAME,
    description: "Run planner and critic collaboration to produce reviewed plans.",
    execute: async (action, params, context) => {
      if (action !== MULTI_AGENT_COLLABORATE_ACTION) {
        return {
          ok: false,
          error: `Unsupported multiagent action: ${action || "unknown"}`
        };
      }

      const goal = pickString(params.goal, params.query, params.input);
      if (!goal) {
        return { ok: false, error: "Missing goal" };
      }

      try {
        const output = await service.collaborate({
          goal,
          sessionId: context.sessionId,
          context: pickString(params.context, params.background)
        });
        return { ok: true, output };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }
  };
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
