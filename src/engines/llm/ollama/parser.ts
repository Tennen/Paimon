import { Action } from "../../../types";
import { parseActionFromLLM } from "../../../core/json_guard";

export function parseAction(rawText: string): Action {
  return parseActionFromLLM(rawText);
}
