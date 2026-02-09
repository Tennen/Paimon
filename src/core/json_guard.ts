import { jsonrepair } from "jsonrepair";
import { Action, ActionType } from "../types";

export function parseActionFromLLM(rawText: string): Action {
  console.log("rawText", rawText);
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("LLM output is not a single JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    try {
      const repaired = jsonrepair(trimmed);
      parsed = JSON.parse(repaired);
    } catch {
      throw new Error("LLM output JSON.parse failed");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM output is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string" || typeof obj.params !== "object" || obj.params === null) {
    throw new Error("LLM output missing type/params");
  }

  const type = assertActionType(obj.type);
  const params = obj.params as Record<string, unknown>;

  return {
    type,
    params
  };
}

function assertActionType(input: string): ActionType {
  if (Object.values(ActionType).includes(input as ActionType)) {
    return input as ActionType;
  }
  throw new Error(`Unsupported action type: ${input}`);
}
