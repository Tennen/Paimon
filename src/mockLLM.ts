import { Action, ActionType } from "./types";

export async function mockLLM(input: string): Promise<Action> {
  const lower = input.toLowerCase();

  if (lower.includes("status") || input.includes("状态")) {
    return {
      type: ActionType.ToolCall,
      params: {
        tool: "homeassistant",
        op: "get_state",
        args: {
          entity_id: "light.living_room"
        }
      }
    };
  }

  if (lower.includes("light") || input.includes("灯")) {
    return {
      type: ActionType.ToolCall,
      params: {
        tool: "homeassistant",
        op: "call_service",
        args: {
          domain: "light",
          service: "turn_on",
          entity_id: "light.living_room",
          data: {
            brightness: 128
          }
        }
      }
    };
  }

  return {
    type: ActionType.Respond,
    params: { text: "OK" }
  };
}
