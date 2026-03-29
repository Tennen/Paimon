import { ParsedEvolutionCommand } from "./types";

const ALLOWED_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const RESET_TOKENS = new Set(["default", "reset", "clear", "none", "空", "默认"]);

export function parseCommand(rawInput: unknown): ParsedEvolutionCommand {
  const raw = String(rawInput ?? "").trim();
  if (!raw) {
    return { scope: "evolution", kind: "help" };
  }

  const directPrefix = raw.match(/^\/(evolve|coding|codex)\b/i);
  const prefix = directPrefix ? String(directPrefix[1] || "").toLowerCase() : "";
  const body = directPrefix ? raw.slice(directPrefix[0].length).trim() : raw;

  if (prefix === "codex") {
    return parseCodexCommand(body);
  }

  return parseEvolutionCommand(body, Boolean(directPrefix));
}

export function parseEvolutionCommand(bodyInput: unknown, fromDirectCommand: boolean): ParsedEvolutionCommand {
  const body = String(bodyInput ?? "").trim();
  if (!body) {
    return { scope: "evolution", kind: "help" };
  }

  if (/^(help|h|\?|帮助)$/i.test(body)) {
    return { scope: "evolution", kind: "help" };
  }

  const statusMatch = body.match(/^(status|state|list|ls)\b\s*(.*)$/i);
  if (statusMatch) {
    const maybeId = extractGoalId(statusMatch[2] || "");
    return { scope: "evolution", kind: "status", goalId: maybeId };
  }

  if (/^(tick|run|next)\b/i.test(body)) {
    return { scope: "evolution", kind: "tick" };
  }

  const logsMatch = body.match(/^(logs?|tail|日志)\b\s*(.*)$/i);
  if (logsMatch) {
    const logsArg = parseLogsArg(logsMatch[2] || "");
    return {
      scope: "evolution",
      kind: "logs",
      ...(logsArg.goalId ? { goalId: logsArg.goalId } : {}),
      ...(logsArg.keyword ? { keyword: logsArg.keyword } : {})
    };
  }

  const confirmMatch = body.match(/^(confirm|approve|approval|确认)\b\s*(.*)$/i);
  if (confirmMatch) {
    return parseConfirmCommand(confirmMatch[2] || "");
  }

  const pendingMatch = body.match(/^(pending|approvals?|待确认)\b\s*(.*)$/i);
  if (pendingMatch) {
    const maybeId = extractGoalId(pendingMatch[2] || "");
    return {
      scope: "evolution",
      kind: "confirm_status",
      ...(maybeId ? { goalId: maybeId } : {})
    };
  }

  const goalBody = body.replace(/^(goal|add|new)\b/i, "").trim() || body;
  const commitMessage = extractCommitMessage(goalBody);
  const goal = stripCommitMessage(goalBody).trim();
  if (!goal) {
    return { scope: "evolution", kind: fromDirectCommand ? "help" : "goal", goal: body };
  }

  return {
    scope: "evolution",
    kind: "goal",
    goal,
    ...(commitMessage ? { commitMessage } : {})
  };
}

export function parseCodexCommand(bodyInput: unknown): ParsedEvolutionCommand {
  const body = String(bodyInput ?? "").trim();
  if (!body) {
    return { scope: "codex", kind: "status" };
  }

  if (/^(help|h|\?|帮助)$/i.test(body)) {
    return { scope: "codex", kind: "help" };
  }

  if (/^(status|state|show|list|ls|查询|查看|状态)$/i.test(body)) {
    return { scope: "codex", kind: "status" };
  }

  const modelMatch = body.match(/^(model|模型)\b\s*(.*)$/i);
  if (modelMatch) {
    const value = normalizeModelValue(modelMatch[2] || "");
    if (value === null) {
      return { scope: "codex", kind: "model_get" };
    }
    return { scope: "codex", kind: "model_set", model: value };
  }

  const effortMatch = body.match(/^(effort|reasoning|reasoning-effort|推理|强度)\b\s*(.*)$/i);
  if (effortMatch) {
    const value = normalizeReasoningEffortValue(effortMatch[2] || "");
    if (value.kind === "invalid") {
      throw new Error("reasoning effort 仅支持: minimal, low, medium, high, xhigh");
    }
    if (value.kind === "empty") {
      return { scope: "codex", kind: "effort_get" };
    }
    return { scope: "codex", kind: "effort_set", reasoningEffort: value.value };
  }

  return { scope: "codex", kind: "help" };
}

export function getEvolutionApi(context: unknown) {
  const candidate = context && typeof context === "object" ? (context as Record<string, unknown>).evolution : null;
  if (!candidate || typeof candidate !== "object") {
    throw new Error("evolution runtime context is unavailable");
  }

  const required = [
    "getSnapshot",
    "enqueueGoal",
    "triggerNow",
    "getCodexConfig",
    "updateCodexConfig"
  ];

  for (const key of required) {
    if (typeof (candidate as Record<string, unknown>)[key] !== "function") {
      throw new Error(`evolution runtime context missing method: ${key}`);
    }
  }

  return candidate as {
    getSnapshot: () => unknown;
    enqueueGoal: (input: { goal: string; commitMessage?: string }) => Promise<unknown>;
    triggerNow: () => Promise<void>;
    triggerNowAsync?: () => void | Promise<void>;
    getPendingConfirmations?: (goalId?: string) => Array<{ taskId: string; at: string; prompt: string; goalId?: string }>;
    submitConfirmation?: (input: { decision: "yes" | "no"; goalId?: string; taskId?: string }) => {
      ok: boolean;
      message: string;
      taskId?: string;
      goalId?: string;
    };
    getCodexConfig: () => { codexModel: string; codexReasoningEffort: string; envPath: string };
    updateCodexConfig: (input: { model?: string; reasoningEffort?: string }) => {
      codexModel: string;
      codexReasoningEffort: string;
      envPath: string;
    };
  };
}

function parseLogsArg(raw: unknown): { goalId: string; keyword: string } {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { goalId: "", keyword: "" };
  }

  const goalId = extractGoalId(text);
  const withoutGoal = goalId
    ? text.replace(goalId, " ").replace(/\s+/g, " ").trim()
    : text;

  const keywordMatch = withoutGoal.match(/(?:kw|keyword|filter|关键词)\s*[:：=]\s*(.+)$/i);
  if (keywordMatch && keywordMatch[1]) {
    return {
      goalId,
      keyword: keywordMatch[1].trim().slice(0, 80)
    };
  }

  return {
    goalId,
    keyword: withoutGoal.slice(0, 80)
  };
}

function parseConfirmCommand(raw: unknown): ParsedEvolutionCommand {
  const text = String(raw ?? "").trim();
  if (!text || /^(status|list|show|pending|查看|状态)$/i.test(text)) {
    return { scope: "evolution", kind: "confirm_status" };
  }

  const matched = text.match(/^([^\s]+)\s*(.*)$/);
  const token = matched ? matched[1] : "";
  const rest = matched ? matched[2] : "";
  const decision = normalizeConfirmDecision(token);
  if (!decision) {
    const maybeGoalId = extractGoalId(text);
    return {
      scope: "evolution",
      kind: "confirm_status",
      ...(maybeGoalId ? { goalId: maybeGoalId } : {})
    };
  }

  const goalId = extractGoalId(rest);
  const taskId = extractCodexTaskId(rest);
  return {
    scope: "evolution",
    kind: "confirm_submit",
    decision,
    ...(goalId ? { goalId } : {}),
    ...(taskId ? { taskId } : {})
  };
}

function normalizeModelValue(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }
  if (RESET_TOKENS.has(text.toLowerCase())) {
    return "";
  }
  return text;
}

function normalizeReasoningEffortValue(
  raw: unknown
): { kind: "empty" } | { kind: "invalid" } | { kind: "value"; value: string } {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) {
    return { kind: "empty" };
  }
  if (RESET_TOKENS.has(text)) {
    return { kind: "value", value: "" };
  }
  if (!ALLOWED_REASONING_EFFORTS.has(text)) {
    return { kind: "invalid" };
  }
  return { kind: "value", value: text };
}

function extractCommitMessage(text: string): string {
  const matched = String(text || "").match(/(?:提交|commit)\s*[:：]\s*(.+)$/i);
  if (!matched || !matched[1]) {
    return "";
  }
  return matched[1].trim().slice(0, 120);
}

function stripCommitMessage(text: string): string {
  return String(text || "").replace(/(?:提交|commit)\s*[:：]\s*.+$/i, "").trim();
}

function extractGoalId(text: string): string {
  const matched = String(text || "").match(/goal-[a-z0-9-]+/i);
  return matched ? matched[0] : "";
}

function extractCodexTaskId(text: string): string {
  const source = String(text || "");
  const explicit = source.match(/(?:task|taskid)\s*[:：=]\s*([a-z0-9._:-]+)/i);
  if (explicit && explicit[1]) {
    return explicit[1];
  }
  const matched = source.match(/\bgoal-[a-z0-9-]+-(?:plan|step-\d+|fix-\d+|structure|commit-message)\b/i);
  return matched ? matched[0] : "";
}

function normalizeConfirmDecision(token: string): "yes" | "no" | "" {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (["yes", "y", "approve", "ok", "同意", "确认", "是"].includes(normalized)) {
    return "yes";
  }
  if (["no", "n", "reject", "deny", "取消", "拒绝", "否"].includes(normalized)) {
    return "no";
  }
  return "";
}
