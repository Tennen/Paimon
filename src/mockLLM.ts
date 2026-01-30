import { Action } from "./types";

export async function mockLLM(input: string): Promise<Action> {
  const lower = input.toLowerCase();

  if (lower.includes("status") || input.includes("状态")) {
    return {
      type: "ha.get_state",
      params: {
        entity_id: "light.living_room"
      }
    };
  }

  if (lower.includes("light") || input.includes("灯")) {
    return {
      type: "ha.call_service",
      params: {
        domain: "light",
        service: "turn_on",
        entity_id: "light.living_room",
        data: {
          brightness: 128
        }
      }
    };
  }

  if (lower.includes("remind")) {
    return {
      type: "reminder.create",
      params: {
        title: "(mock reminder)",
        due: new Date().toISOString(),
        list: "Inbox"
      }
    };
  }

  if (lower.includes("note")) {
    return {
      type: "note.create",
      params: {
        folder: "Inbox",
        title: "(mock note)",
        content: input
      }
    };
  }

  return {
    type: "noop",
    params: {}
  };
}
