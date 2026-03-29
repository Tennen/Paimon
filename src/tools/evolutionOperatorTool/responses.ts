export function buildEvolutionHelpText(): string {
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

export function buildCodexHelpText(): string {
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

export function buildCodexStatusText(config: { codexModel: string; codexReasoningEffort: string; envPath: string }): string {
  return [
    "Codex 当前配置：",
    `model: ${config && config.codexModel ? config.codexModel : "(default)"}`,
    `reasoning effort: ${config && config.codexReasoningEffort ? config.codexReasoningEffort : "(default)"}`,
    `env: ${config && config.envPath ? config.envPath : "-"}`
  ].join("\n");
}

export function buildTickAcceptedText(): string {
  return [
    "已受理 Evolution Tick（异步执行）。",
    "可用：/evolve status 查看状态",
    "可用：/evolve logs 查看最新日志"
  ].join("\n");
}

export function buildStatusResponse(snapshot: unknown, goalId?: string): string {
  const payload: any = snapshot ?? {};
  const state: any = payload.state ?? {};
  const metrics: any = payload.metrics ?? {};
  const goals: any[] = Array.isArray(state.goals) ? state.goals : [];
  const retryItems: any[] = Array.isArray(payload.retryQueue?.items) ? payload.retryQueue.items : [];

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
    .sort((left, right) => Date.parse(String(right.updatedAt || "")) - Date.parse(String(left.updatedAt || "")))
    .slice(0, 5)
    .map((item) => {
      const summary = trimText(String(item.goal || ""), 32);
      return `- ${item.id} [${item.status || "unknown"}] stage=${item.stage || "-"} step ${toIntValue(item.plan && item.plan.currentStep)}/${Array.isArray(item.plan && item.plan.steps) ? item.plan.steps.length : 0} ${summary}`;
    });

  const currentGoal = state && state.currentGoalId
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

export function buildLogsResponse(
  snapshot: unknown,
  input: { goalId?: string; keyword?: string }
): string {
  const payload: any = snapshot ?? {};
  const state: any = payload.state ?? {};
  const goals: any[] = Array.isArray(state.goals) ? state.goals : [];
  const target = resolveGoalForLogs(goals, state.currentGoalId, input?.goalId ?? "");

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

export function buildPendingConfirmationsText(
  pending: Array<{ taskId: string; at: string; prompt: string; goalId?: string }> | undefined,
  goalId?: string
): string {
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

export function buildConfirmSubmitResponse(result: { ok: boolean; message: string; taskId?: string; goalId?: string } | undefined): string {
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

function resolveGoalForLogs(
  goals: any[],
  currentGoalId: string | undefined,
  requestedGoalId: string
): any | null {
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
    .sort((left, right) => Date.parse(String(right.updatedAt || "")) - Date.parse(String(left.updatedAt || "")))
    .find(Boolean) || null;
}

function formatEvents(events: unknown, maxCount: number): string[] {
  const list: any[] = Array.isArray(events) ? events : [];
  return list.slice(-Math.max(1, maxCount)).map((event) => {
    const at = event && typeof event === "object" && (event as { at?: string }).at ? (event as { at: string }).at : "-";
    const stage = event && typeof event === "object" && (event as { stage?: string }).stage ? (event as { stage: string }).stage : "event";
    const message = event && typeof event === "object" && (event as { message?: string }).message ? trimText(String((event as { message: string }).message), 220) : "";
    return `- [${at}] ${stage}: ${message}`;
  });
}

function formatRawTail(
  rawTail: unknown,
  maxCount: number,
  options: { keyword?: string; strictTextOnly?: boolean }
): string[] {
  const list: any[] = Array.isArray(rawTail) ? rawTail : [];
  const keyword = String(options && options.keyword ? options.keyword : "").trim().toLowerCase();
  const strictTextOnly = Boolean(options && options.strictTextOnly);

  const rows: string[] = [];
  for (const item of list.slice(-Math.max(1, maxCount))) {
    const at = item && typeof item === "object" && (item as { at?: string }).at ? (item as { at: string }).at : "-";
    const rawLine = item && typeof item === "object" && (item as { line?: string }).line ? String((item as { line: string }).line) : "";
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

function normalizeLogLine(line: string, strictTextOnly: boolean): string {
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

function parseCodexJsonLikeLine(line: string): string {
  const text = String(line || "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return "";
  }

  let parsed: Record<string, unknown> | null = null;
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
    const error = parsed.error && typeof parsed.error === "object" && typeof (parsed.error as { message?: string }).message === "string"
      ? (parsed.error as { message: string }).message
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
    const item = parsed.item && typeof parsed.item === "object" && !Array.isArray(parsed.item) ? parsed.item as Record<string, unknown> : null;
    const itemType = item && typeof item.type === "string" ? item.type : "";
    const itemMessage = item && typeof item.message === "string" ? item.message : "";
    if (itemType || itemMessage) {
      return [itemType, itemMessage].filter(Boolean).join(": ");
    }
  }
  return message;
}

function toIntValue(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.floor(numeric);
}

function trimText(text: string, maxLength: number): string {
  const value = String(text ?? "");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
