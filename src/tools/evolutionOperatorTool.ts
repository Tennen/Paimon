// @ts-nocheck
import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import { ToolResult } from "../types";

const ALLOWED_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const RESET_TOKENS = new Set(["default", "reset", "clear", "none", "空", "默认"]);

export const evolutionDirectCommands = ["/evolve", "/coding"];
export const codexDirectCommands = ["/codex"];

type EvolutionServiceBridge = {
  getTickMs: () => number;
  getSnapshot: () => unknown;
  enqueueGoal: (input: { goal: string; commitMessage?: string }) => Promise<unknown>;
  triggerNow: () => Promise<void>;
  triggerNowAsync?: () => void | Promise<void>;
  listPendingCodexApprovals?: (goalId?: string) => Array<{ taskId: string; at: string; prompt: string; goalId?: string }>;
  submitCodexApproval?: (input: {
    decision: "yes" | "no";
    goalId?: string;
    taskId?: string;
  }) => { ok: boolean; message: string; taskId?: string; goalId?: string };
  getCodexConfig: () => { codexModel: string; codexReasoningEffort: string; envPath: string };
  updateCodexConfig: (input: { model?: string; reasoningEffort?: string }) => {
    codexModel: string;
    codexReasoningEffort: string;
    envPath: string;
  };
};

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const evolutionService = deps.evolutionService as EvolutionServiceBridge | undefined;

  registry.register(
    {
      name: "skill.evolution-operator",
      execute: (op, args, context) =>
        executeInputTool(
          op,
          args,
          async (input) => execute(input, buildEvolutionContext(context, evolutionService))
        )
    },
    {
      name: "skill.evolution-operator",
      description: "Control built-in evolution runtime via chat commands.",
      operations: [
        {
          op: "execute",
          description: "Execute evolution operator command.",
          params: {
            input: "string"
          }
        }
      ]
    }
  );

  registerDirectCommands(registry, evolutionDirectCommands, {
    tool: "skill.evolution-operator",
    op: "execute",
    argName: "input",
    argMode: "full_input",
    preferToolResult: true,
    async: true,
    acceptedText: "收到，Evolution 任务已受理，后台处理中；完成后会回传结果。",
    acceptedDelayMs: 1200
  });

  registerDirectCommands(registry, codexDirectCommands, {
    tool: "skill.evolution-operator",
    op: "execute",
    argName: "input",
    argMode: "full_input",
    preferToolResult: true
  });
}

async function executeInputTool(
  op: string,
  args: Record<string, unknown>,
  runner: (input: string) => Promise<unknown>
): Promise<ToolResult> {
  if (op !== "execute") {
    return { ok: false, error: `Unsupported action: ${op}` };
  }
  const input = String(args.input ?? "").trim();
  if (!input) {
    return { ok: false, error: "Missing input" };
  }

  try {
    const output = await runner(input);
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function buildEvolutionContext(
  context: Record<string, unknown>,
  evolutionService?: EvolutionServiceBridge
): Record<string, unknown> {
  if (!evolutionService) {
    return context;
  }

  return {
    ...context,
    evolution: {
      getTickMs: () => evolutionService.getTickMs(),
      getSnapshot: () => evolutionService.getSnapshot(),
      enqueueGoal: (input: { goal: string; commitMessage?: string }) => evolutionService.enqueueGoal(input),
      triggerNow: () => evolutionService.triggerNow(),
      triggerNowAsync: () => evolutionService.triggerNowAsync?.(),
      getPendingConfirmations: (goalId?: string) => evolutionService.listPendingCodexApprovals?.(goalId) ?? [],
      submitConfirmation: (input: { decision: "yes" | "no"; goalId?: string; taskId?: string }) =>
        evolutionService.submitCodexApproval?.(input) ?? { ok: false, message: "当前版本不支持确认命令" },
      getCodexConfig: () => evolutionService.getCodexConfig(),
      updateCodexConfig: (input: { model?: string; reasoningEffort?: string }) =>
        evolutionService.updateCodexConfig(input)
    }
  };
}

function registerDirectCommands(
  registry: ToolRegistry,
  commands: string[],
  route: {
    tool: string;
    op: string;
    argName: string;
    argMode: "full_input" | "rest";
    preferToolResult?: boolean;
    async?: boolean;
    acceptedText?: string;
    acceptedDelayMs?: number;
  }
): void {
  for (const command of commands) {
    registry.registerDirectToolCall({
      command,
      tool: route.tool,
      op: route.op,
      argName: route.argName,
      argMode: route.argMode,
      preferToolResult: route.preferToolResult ?? true,
      async: route.async ?? false,
      acceptedText: route.acceptedText,
      acceptedDelayMs: route.acceptedDelayMs
    });
  }
}

export async function execute(input, context) {
  const api = getEvolutionApi(context);
  const raw = String(input || "").trim();
  const command = parseCommand(raw);

  if (command.scope === "codex") {
    return handleCodexCommand(command, api);
  }

  if (command.kind === "help") {
    return { text: buildEvolutionHelpText() };
  }

  if (command.kind === "tick") {
    const trigger = typeof api.triggerNowAsync === "function" ? api.triggerNowAsync : api.triggerNow;
    void Promise.resolve(trigger()).catch(() => undefined);
    return { text: buildTickAcceptedText() };
  }

  if (command.kind === "status") {
    const snapshot = await Promise.resolve(api.getSnapshot());
    return { text: buildStatusResponse(snapshot, command.goalId) };
  }

  if (command.kind === "logs") {
    const snapshot = await Promise.resolve(api.getSnapshot());
    return {
      text: buildLogsResponse(snapshot, {
        goalId: command.goalId,
        keyword: command.keyword
      })
    };
  }

  if (command.kind === "confirm_status") {
    const pending = await Promise.resolve(
      typeof api.getPendingConfirmations === "function"
        ? api.getPendingConfirmations(command.goalId)
        : []
    );
    return { text: buildPendingConfirmationsText(pending, command.goalId) };
  }

  if (command.kind === "confirm_submit") {
    if (typeof api.submitConfirmation !== "function") {
      return { text: "当前版本不支持确认命令，请升级 evolution runtime。" };
    }
    const submitted = await Promise.resolve(api.submitConfirmation({
      decision: command.decision,
      ...(command.goalId ? { goalId: command.goalId } : {}),
      ...(command.taskId ? { taskId: command.taskId } : {})
    }));
    return {
      text: buildConfirmSubmitResponse(submitted)
    };
  }

  const created = await Promise.resolve(api.enqueueGoal({
    goal: command.goal,
    ...(command.commitMessage ? { commitMessage: command.commitMessage } : {})
  }));
  const goalId = typeof created?.id === "string" ? created.id : "unknown";
  const status = typeof created?.status === "string" ? created.status : "pending";
  const commitMessage = typeof created?.commitMessage === "string" ? created.commitMessage : "";

  return {
    text: [
      `已创建 Evolution Goal: ${goalId}`,
      `状态: ${status}`,
      commitMessage ? `commit: ${commitMessage}` : "",
      "可用指令：/evolve status | /evolve tick | /codex status"
    ]
      .filter(Boolean)
      .join("\n")
  };
}

async function handleCodexCommand(command, api) {
  if (command.kind === "help") {
    return { text: buildCodexHelpText() };
  }

  if (command.kind === "status") {
    const config = await Promise.resolve(api.getCodexConfig());
    return { text: buildCodexStatusText(config) };
  }

  if (command.kind === "model_get") {
    const config = await Promise.resolve(api.getCodexConfig());
    return { text: `Codex model: ${config.codexModel || "(default)"}` };
  }

  if (command.kind === "model_set") {
    const config = await Promise.resolve(api.updateCodexConfig({ model: command.model }));
    return {
      text: [
        "Codex model 已更新。",
        `当前 model: ${config.codexModel || "(default)"}`,
        `当前 reasoning effort: ${config.codexReasoningEffort || "(default)"}`
      ].join("\n")
    };
  }

  if (command.kind === "effort_get") {
    const config = await Promise.resolve(api.getCodexConfig());
    return { text: `Codex reasoning effort: ${config.codexReasoningEffort || "(default)"}` };
  }

  if (command.kind === "effort_set") {
    const config = await Promise.resolve(api.updateCodexConfig({ reasoningEffort: command.reasoningEffort }));
    return {
      text: [
        "Codex reasoning effort 已更新。",
        `当前 reasoning effort: ${config.codexReasoningEffort || "(default)"}`,
        `当前 model: ${config.codexModel || "(default)"}`
      ].join("\n")
    };
  }

  return { text: buildCodexHelpText() };
}

function parseCommand(rawInput) {
  const raw = String(rawInput || "").trim();
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

function parseEvolutionCommand(bodyInput, fromDirectCommand) {
  const body = String(bodyInput || "").trim();
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

function parseLogsArg(raw) {
  const text = String(raw || "").trim();
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

function parseConfirmCommand(raw) {
  const text = String(raw || "").trim();
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

function parseCodexCommand(bodyInput) {
  const body = String(bodyInput || "").trim();
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

function normalizeModelValue(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }
  if (RESET_TOKENS.has(text.toLowerCase())) {
    return "";
  }
  return text;
}

function normalizeReasoningEffortValue(raw) {
  const text = String(raw || "").trim().toLowerCase();
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

function getEvolutionApi(context) {
  const candidate = context && typeof context === "object" ? context.evolution : null;
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
    if (typeof candidate[key] !== "function") {
      throw new Error(`evolution runtime context missing method: ${key}`);
    }
  }

  return candidate;
}

function extractCommitMessage(text) {
  const matched = String(text || "").match(/(?:提交|commit)\s*[:：]\s*(.+)$/i);
  if (!matched || !matched[1]) {
    return "";
  }
  return matched[1].trim().slice(0, 120);
}

function stripCommitMessage(text) {
  return String(text || "").replace(/(?:提交|commit)\s*[:：]\s*.+$/i, "").trim();
}

function extractGoalId(text) {
  const matched = String(text || "").match(/goal-[a-z0-9-]+/i);
  return matched ? matched[0] : "";
}

function extractCodexTaskId(text) {
  const source = String(text || "");
  const explicit = source.match(/(?:task|taskid)\s*[:：=]\s*([a-z0-9._:-]+)/i);
  if (explicit && explicit[1]) {
    return explicit[1];
  }
  const matched = source.match(/\bgoal-[a-z0-9-]+-(?:plan|step-\d+|fix-\d+|structure|commit-message)\b/i);
  return matched ? matched[0] : "";
}

function normalizeConfirmDecision(token) {
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

function buildEvolutionHelpText() {
  return [
    "Evolution 指令：",
    "/evolve <goal>：创建新 Goal",
    "/coding <goal>：同 /evolve",
    "/evolve status：查看整体状态",
    "/evolve status <goalId>：查看指定 Goal",
    "/evolve tick：异步触发一轮执行",
    "/evolve logs [goalId] [关键词]：查看最近 5 行日志",
    "/evolve confirm：查看待确认的 codex 交互",
    "/evolve confirm yes|no [goalId|taskId]：提交确认",
    "可在 goal 后追加：提交: <commit message>（可选）",
    "不传 commitMessage 时，系统会在提交前自动生成",
    "任务成功后会自动 commit + push；push 失败会导致 Goal 失败",
    "Codex 配置：/codex status | /codex model | /codex effort"
  ].join("\n");
}

function buildCodexHelpText() {
  return [
    "Codex 配置指令：",
    "/codex status：查看当前 codex 配置",
    "/codex model：查看当前 model",
    "/codex model <name>：设置 codex model",
    "/codex model default：清空 model 覆盖",
    "/codex effort：查看当前 reasoning effort",
    "/codex effort <minimal|low|medium|high|xhigh>：设置 reasoning effort",
    "/codex effort default：清空 reasoning effort 覆盖"
  ].join("\n");
}

function buildCodexStatusText(config) {
  return [
    "Codex 当前配置：",
    `model: ${config && config.codexModel ? config.codexModel : "(default)"}`,
    `reasoning effort: ${config && config.codexReasoningEffort ? config.codexReasoningEffort : "(default)"}`,
    `env: ${config && config.envPath ? config.envPath : "-"}`
  ].join("\n");
}

function buildTickAcceptedText() {
  return [
    "已受理 Evolution Tick（异步执行）。",
    "可用：/evolve status 查看状态",
    "可用：/evolve logs 查看最新日志"
  ].join("\n");
}

function buildStatusResponse(snapshot, goalId) {
  const state = snapshot && snapshot.state ? snapshot.state : {};
  const metrics = snapshot && snapshot.metrics ? snapshot.metrics : {};
  const goals = Array.isArray(state.goals) ? state.goals : [];
  const retryItems = snapshot && snapshot.retryQueue && Array.isArray(snapshot.retryQueue.items)
    ? snapshot.retryQueue.items
    : [];

  if (goalId) {
    const target = goals.find((item) => item && item.id === goalId);
    if (!target) {
      return `未找到 Goal: ${goalId}`;
    }

    const eventsText = formatEvents(target.events, 8);
    const rawTailText = formatRawTail(target.rawTail, 8, { strictTextOnly: true });
    return [
      `Goal: ${target.id}`,
      `状态: ${target.status || "unknown"}`,
      `阶段: ${target.stage || "-"}`,
      `步骤: ${toIntValue(target.plan && target.plan.currentStep)}/${Array.isArray(target.plan && target.plan.steps) ? target.plan.steps.length : 0}`,
      `重试次数: ${toIntValue(target.retries)}`,
      `最近错误: ${target.lastError || "-"}`,
      `更新时间: ${target.updatedAt || "-"}`,
      "",
      "关键节点:",
      ...(eventsText.length > 0 ? eventsText : ["- (暂无事件)"]),
      "",
      "最近输出:",
      ...(rawTailText.length > 0 ? rawTailText : ["- (暂无输出)"])
    ].join("\n");
  }

  const recent = goals
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))
    .slice(0, 5)
    .map((item) => {
      const summary = trimText(String(item.goal || ""), 32);
      return `- ${item.id} [${item.status || "unknown"}] stage=${item.stage || "-"} step ${toIntValue(item.plan && item.plan.currentStep)}/${Array.isArray(item.plan && item.plan.steps) ? item.plan.steps.length : 0} ${summary}`;
    });

  const currentGoal = state.currentGoalId
    ? goals.find((item) => item && item.id === state.currentGoalId)
    : null;
  const currentEvents = currentGoal ? formatEvents(currentGoal.events, 4) : [];

  return [
    `引擎状态: ${state.status || "unknown"}`,
    `当前任务: ${state.currentGoalId || "-"}`,
    `当前阶段: ${currentGoal && currentGoal.stage ? currentGoal.stage : "-"}`,
    `队列重试: ${retryItems.length}`,
    `总 Goals: ${toIntValue(metrics.totalGoals)}, 失败: ${toIntValue(metrics.totalFailures)}, 总重试: ${toIntValue(metrics.totalRetries)}`,
    ...(currentEvents.length > 0 ? ["当前任务关键节点:", ...currentEvents] : []),
    "最近 Goals:",
    ...(recent.length > 0 ? recent : ["- (empty)"])
  ].join("\n");
}

function buildLogsResponse(snapshot, input) {
  const state = snapshot && snapshot.state ? snapshot.state : {};
  const goals = Array.isArray(state.goals) ? state.goals : [];
  const target = resolveGoalForLogs(goals, state.currentGoalId, input && input.goalId ? input.goalId : "");

  if (!target) {
    return "暂无可用日志。可先执行 /evolve <goal> 创建任务。";
  }

  const keyword = String(input && input.keyword ? input.keyword : "").trim();
  const lines = formatRawTail(target.rawTail, 120, { keyword, strictTextOnly: true });
  const latest = lines.slice(-5);
  const totalRawCount = Array.isArray(target.rawTail) ? target.rawTail.length : 0;

  return [
    `Goal: ${target.id}`,
    `状态: ${target.status || "unknown"}，阶段: ${target.stage || "-"}`,
    `筛选: ${keyword ? keyword : "(无)"}`,
    `日志: ${latest.length} / ${totalRawCount}`,
    "最近 5 行:",
    ...(latest.length > 0 ? latest : ["- (无匹配日志)"])
  ].join("\n");
}

function buildPendingConfirmationsText(pending, goalId) {
  const list = Array.isArray(pending) ? pending : [];
  if (list.length === 0) {
    return goalId
      ? `Goal ${goalId} 当前没有待确认的 codex 交互。`
      : "当前没有待确认的 codex 交互。";
  }

  const rows = list.slice(0, 8).map((item) => {
    const taskId = item && item.taskId ? item.taskId : "-";
    const goal = item && item.goalId ? item.goalId : "-";
    const at = item && item.at ? item.at : "-";
    const prompt = item && item.prompt ? trimText(String(item.prompt), 120) : "";
    return `- [${at}] ${taskId} (goal=${goal}) ${prompt}`;
  });
  return [
    `待确认任务: ${list.length}`,
    ...rows,
    "使用：/evolve confirm yes|no <taskId|goalId>"
  ].join("\n");
}

function buildConfirmSubmitResponse(result) {
  const ok = result && result.ok === true;
  const message = result && result.message ? String(result.message) : ok ? "确认已提交" : "确认提交失败";
  return [
    ok ? "确认已提交。" : "确认提交失败。",
    message,
    result && result.taskId ? `task: ${result.taskId}` : "",
    result && result.goalId ? `goal: ${result.goalId}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function trimText(text, maxLength) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function formatEvents(events, maxCount) {
  const list = Array.isArray(events) ? events : [];
  return list.slice(-Math.max(1, maxCount)).map((event) => {
    const at = event && event.at ? event.at : "-";
    const stage = event && event.stage ? event.stage : "event";
    const message = event && event.message ? trimText(String(event.message), 220) : "";
    return `- [${at}] ${stage}: ${message}`;
  });
}

function formatRawTail(rawTail, maxCount, options) {
  const list = Array.isArray(rawTail) ? rawTail : [];
  const keyword = String(options && options.keyword ? options.keyword : "").trim().toLowerCase();
  const strictTextOnly = Boolean(options && options.strictTextOnly);

  const rows = [];
  for (const item of list.slice(-Math.max(1, maxCount))) {
    const at = item && item.at ? item.at : "-";
    const rawLine = item && item.line ? String(item.line) : "";
    const normalizedLine = normalizeLogLine(rawLine, strictTextOnly);
    if (!normalizedLine) {
      continue;
    }
    if (keyword && !normalizedLine.toLowerCase().includes(keyword)) {
      continue;
    }
    rows.push(`- [${at}] ${trimText(normalizedLine, 220)}`);
  }
  return rows;
}

function resolveGoalForLogs(goals, currentGoalId, requestedGoalId) {
  const list = Array.isArray(goals) ? goals : [];
  const requested = String(requestedGoalId || "").trim();
  if (requested) {
    return list.find((item) => item && item.id === requested) || null;
  }
  if (currentGoalId) {
    const current = list.find((item) => item && item.id === currentGoalId);
    if (current) {
      return current;
    }
  }
  return list
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))
    .find(Boolean) || null;
}

function normalizeLogLine(line, strictTextOnly) {
  const text = String(line || "").trim();
  if (!text) {
    return "";
  }

  const codexMatch = text.match(/^\[codex (stdout|stderr)\]\s*(.*)$/i);
  if (codexMatch) {
    const converted = parseCodexJsonLikeLine(codexMatch[2]);
    if (converted) {
      const prefix = codexMatch[1].toLowerCase() === "stderr" ? "stderr" : "stdout";
      return `${prefix}: ${converted}`;
    }

    if (strictTextOnly && /^\{.*\}$/.test(codexMatch[2].trim())) {
      return "";
    }
    return codexMatch[2].trim();
  }

  if (strictTextOnly && /^\{.*\}$/.test(text)) {
    const converted = parseCodexJsonLikeLine(text);
    return converted || "";
  }
  return text;
}

function parseCodexJsonLikeLine(line) {
  const text = String(line || "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return "";
  }

  let parsed = null;
  try {
    const payload = JSON.parse(text);
    parsed = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return "";
  }

  const type = typeof parsed.type === "string" ? parsed.type : "";
  const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
  if (type === "thread.started") {
    const threadId = typeof parsed.thread_id === "string" ? parsed.thread_id : "";
    return threadId ? `thread started (${threadId})` : "thread started";
  }
  if (type === "turn.started") return "turn started";
  if (type === "turn.completed") return "turn completed";
  if (type === "turn.failed") {
    const error = parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string"
      ? parsed.error.message
      : message || "turn failed";
    return `turn failed: ${error}`;
  }
  if (type === "approval_required" || type.includes("approval") || type.includes("confirm")) {
    return message || `等待确认: ${type}`;
  }
  if (type === "error") {
    return message || "error";
  }
  if (type === "item.completed") {
    const item = parsed.item && typeof parsed.item === "object" && !Array.isArray(parsed.item) ? parsed.item : null;
    const itemType = item && typeof item.type === "string" ? item.type : "";
    const itemMessage = item && typeof item.message === "string" ? item.message : "";
    if (itemType || itemMessage) {
      return [itemType, itemMessage].filter(Boolean).join(": ");
    }
  }
  return message;
}

function toIntValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.floor(numeric);
}
