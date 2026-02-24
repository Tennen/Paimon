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

  if (typeof obj.tool !== "string" || typeof obj.op !== "string") {
    throw new Error("Missing tool/op in LLM output");
  }
  if (typeof obj.args !== "object" || obj.args === null) {
    throw new Error("Missing args in LLM output");
  }

  return {
    tool: obj.tool,
    op: obj.op,
    args: obj.args as Record<string, unknown>,
    success_response: typeof obj.success_response === "string" ? obj.success_response : "Task completed successfully",
    failure_response: typeof obj.failure_response === "string" ? obj.failure_response : "Tool execution failed",
  };
}
