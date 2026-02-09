import { Action } from "../types";

export function parseActionFromLLM(rawText: string): Action {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("LLM output is not a single JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error("LLM output JSON.parse failed");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM output is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string" || typeof obj.params !== "object" || obj.params === null) {
    throw new Error("LLM output missing type/params");
  }

  return {
    type: obj.type,
    params: obj.params as Record<string, unknown>
  };
}
