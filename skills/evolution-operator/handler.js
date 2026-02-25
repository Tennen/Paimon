const ALLOWED_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const RESET_TOKENS = new Set(["default", "reset", "clear", "none", "空", "默认"]);

module.exports.directCommands = ["/evolve", "/coding", "/codex"];

module.exports.execute = async function execute(input, context) {
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
    await Promise.resolve(api.triggerNow());
    const snapshot = await Promise.resolve(api.getSnapshot());
    return { text: buildTickResponse(snapshot) };
  }

  if (command.kind === "status") {
    const snapshot = await Promise.resolve(api.getSnapshot());
    return { text: buildStatusResponse(snapshot, command.goalId) };
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
};

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

function buildEvolutionHelpText() {
  return [
    "Evolution 指令：",
    "/evolve <goal>：创建新 Goal",
    "/coding <goal>：同 /evolve",
    "/evolve status：查看整体状态",
    "/evolve status <goalId>：查看指定 Goal",
    "/evolve tick：立即触发一轮执行",
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

function buildTickResponse(snapshot) {
  const state = snapshot && snapshot.state ? snapshot.state : {};
  const retryQueue = snapshot && snapshot.retryQueue ? snapshot.retryQueue : {};
  return [
    "已触发 Evolution Tick。",
    `引擎状态: ${state.status || "unknown"}`,
    `当前任务: ${state.currentGoalId || "-"}`,
    `重试队列: ${Array.isArray(retryQueue.items) ? retryQueue.items.length : 0}`
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
    const rawTailText = formatRawTail(target.rawTail, 8);
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

function formatRawTail(rawTail, maxCount) {
  const list = Array.isArray(rawTail) ? rawTail : [];
  return list.slice(-Math.max(1, maxCount)).map((item) => {
    const at = item && item.at ? item.at : "-";
    const line = item && item.line ? trimText(String(item.line), 220) : "";
    return `- [${at}] ${line}`;
  });
}

function toIntValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.floor(numeric);
}
