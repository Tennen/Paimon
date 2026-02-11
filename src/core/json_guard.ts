import { jsonrepair } from "jsonrepair";
import { SkillSelectionResult, SkillPlanningResult } from "../types";

export function parseSkillSelectionResult(rawText: string): SkillSelectionResult {
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
  const decision = obj.decision;

  if (decision !== "respond" && decision !== "use_skill") {
    throw new Error(`Invalid decision: ${decision}`);
  }

  return {
    decision: decision as "respond" | "use_skill",
    skill_name: typeof obj.skill_name === "string" ? obj.skill_name : undefined,
    response_text: typeof obj.response_text === "string" ? obj.response_text : undefined,
  };
}

export function parseSkillPlanningResult(rawText: string): SkillPlanningResult {
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

  if (typeof obj.tool !== "string" || typeof obj.op !== "string") {
    throw new Error("Missing tool/op in LLM output");
  }
  if (typeof obj.args !== "object" || obj.args === null) {
    throw new Error("Missing args in LLM output");
  }
  if (typeof obj.success_response !== "string") {
    throw new Error("Missing success_response in LLM output");
  }

  return {
    tool: obj.tool,
    op: obj.op,
    args: obj.args as Record<string, unknown>,
    success_response: obj.success_response,
    failure_response: typeof obj.failure_response === "string" ? obj.failure_response : "Tool execution failed",
  };
}
