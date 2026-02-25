const DEFAULT_PORT = process.env.PORT || "3000";
const BASE_URL = (process.env.EVOLUTION_ADMIN_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = toInt(process.env.EVOLUTION_OPERATOR_TIMEOUT_MS, 12000);

module.exports.directCommands = ["/evolve", "/coding"];

module.exports.execute = async function execute(input) {
  const raw = String(input || "").trim();
  const command = parseCommand(raw);

  if (command.kind === "help") {
    return { text: buildHelpText() };
  }

  if (command.kind === "tick") {
    await requestJson("/admin/api/evolution/tick", {
      method: "POST",
      body: {}
    });
    const snapshot = await fetchSnapshot();
    return { text: buildTickResponse(snapshot) };
  }

  if (command.kind === "status") {
    const snapshot = await fetchSnapshot();
    return { text: buildStatusResponse(snapshot, command.goalId) };
  }

  const payload = await requestJson("/admin/api/evolution/goals", {
    method: "POST",
    body: {
      goal: command.goal,
      ...(command.commitMessage ? { commitMessage: command.commitMessage } : {})
    }
  });

  const created = payload && payload.goal && typeof payload.goal === "object" ? payload.goal : {};
  const goalId = typeof created.id === "string" ? created.id : "unknown";
  const status = typeof created.status === "string" ? created.status : "pending";
  const commitMessage = typeof created.commitMessage === "string" ? created.commitMessage : "";

  return {
    text: [
      `已创建 Evolution Goal: ${goalId}`,
      `状态: ${status}`,
      commitMessage ? `commit: ${commitMessage}` : "",
      "可用指令：/evolve status | /evolve tick"
    ]
      .filter(Boolean)
      .join("\n")
  };
};

function parseCommand(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return { kind: "help" };
  }

  let body = raw;
  const prefixMatch = raw.match(/^\/(?:evolve|coding)\b/i);
  if (prefixMatch) {
    body = raw.slice(prefixMatch[0].length).trim();
  }

  if (!body) {
    return { kind: "help" };
  }

  if (/^(help|h|\?)$/i.test(body)) {
    return { kind: "help" };
  }

  const statusMatch = body.match(/^(status|state|list|ls)\b\s*(.*)$/i);
  if (statusMatch) {
    const maybeId = extractGoalId(statusMatch[2] || "");
    return { kind: "status", goalId: maybeId };
  }

  if (/^(tick|run|next)\b/i.test(body)) {
    return { kind: "tick" };
  }

  const goalBody = body.replace(/^(goal|add|new)\b/i, "").trim() || body;
  const commitMessage = extractCommitMessage(goalBody);
  const goal = stripCommitMessage(goalBody).trim();
  if (!goal) {
    return { kind: "help" };
  }

  return {
    kind: "goal",
    goal,
    ...(commitMessage ? { commitMessage } : {})
  };
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

function buildHelpText() {
  return [
    "Evolution 指令：",
    "/evolve <goal>：创建新 Goal",
    "/coding <goal>：同 /evolve",
    "/evolve status：查看整体状态",
    "/evolve status <goalId>：查看指定 Goal",
    "/evolve tick：立即触发一轮执行",
    "可在 goal 后追加：提交: <commit message>（可选）",
    "不传 commitMessage 时，系统会在提交前自动生成",
    "任务成功后会自动 commit + push；push 失败会导致 Goal 失败"
  ].join("\n");
}

async function fetchSnapshot() {
  return requestJson("/admin/api/evolution/state", {
    method: "GET"
  });
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

async function requestJson(pathname, options) {
  const method = options && options.method ? options.method : "GET";
  const body = options && options.body !== undefined ? options.body : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });

    const raw = await response.text();
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { error: raw };
      }
    }

    if (!response.ok) {
      const detail = payload && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new Error(`evolution-operator request failed: ${detail}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
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

function toInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
