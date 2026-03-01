import { jsonrepair } from "jsonrepair";
import { SkillSelectionResult, SkillPlanningResult } from "../../types";

function normalizeRawJson(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3) {
    return trimmed;
  }

  const firstLine = lines[0].trim();
  const lastLine = lines[lines.length - 1].trim();

  if (!firstLine.startsWith("```") || !lastLine.startsWith("```")) {
    return trimmed;
  }

  return lines.slice(1, -1).join("\n").trim();
}

function parseJsonObject(rawText: string): Record<string, unknown> {
  const normalized = normalizeRawJson(rawText);
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) {
    throw new Error("LLM output is not a single JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    try {
      const repaired = jsonrepair(normalized);
      parsed = JSON.parse(repaired);
    } catch {
      throw new Error("LLM output JSON.parse failed");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM output is not a JSON object");
  }

  return parsed as Record<string, unknown>;
}

export function parseSkillSelectionResult(rawText: string): SkillSelectionResult {
  console.log("rawText", rawText);
  const obj = parseJsonObject(rawText);
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
  const obj = parseJsonObject(rawText);

  const action = typeof obj.action === "string" ? obj.action : typeof obj.op === "string" ? obj.op : "";
  const params = obj.params && typeof obj.params === "object"
    ? obj.params as Record<string, unknown>
    : obj.args && typeof obj.args === "object"
      ? obj.args as Record<string, unknown>
      : null;

  if (typeof obj.tool !== "string" || !action) {
    throw new Error("Missing tool/action in LLM output");
  }
  if (!params) {
    throw new Error("Missing params in LLM output");
  }

  return {
    tool: obj.tool,
    op: action,
    args: params,
    success_response: typeof obj.success_response === "string" ? obj.success_response : "Task completed successfully",
    failure_response: typeof obj.failure_response === "string" ? obj.failure_response : "Tool execution failed",
  };
}
