import { SkillSelectionResult, SkillPlanningResult } from "./types";

export async function mockLLM(input: string): Promise<SkillSelectionResult | SkillPlanningResult> {
  const lower = input.toLowerCase();

  if (lower.includes("status") || input.includes("状态")) {
    return {
      tool: "homeassistant",
      op: "get_state",
      args: {
        entity_id: "light.living_room"
      },
      success_response: "Got the status of the light",
      failure_response: "Failed to get the light status"
    };
  }

  if (lower.includes("light") || input.includes("灯")) {
    return {
      tool: "homeassistant",
      op: "call_service",
      args: {
        domain: "light",
        service: "turn_on",
        entity_id: "light.living_room",
        data: {
          brightness: 128
        }
      },
      success_response: "Light has been turned on",
      failure_response: "Failed to turn on the light"
    };
  }

  return {
    decision: "respond",
    response_text: "OK"
  };
}
