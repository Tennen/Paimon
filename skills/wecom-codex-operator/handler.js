const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const STORE_DIR = path.join(ROOT_DIR, "data", "codex-cli-skill");
const OUTPUT_DIR = path.join(STORE_DIR, "outputs");
const CODEX_HOME_DIR = path.join(STORE_DIR, "codex-home");
const STORE_FILE = path.join(STORE_DIR, "tasks.json");

const MAX_EVENTS = 40;
const MAX_RAW_LINES = 80;
const MAX_DISPLAY_EVENTS = 8;
const MAX_DISPLAY_LINES = 8;

const runningTaskIds = new Set();

ensureDirs();
const state = loadState();

module.exports.execute = async function execute(input, context) {
  const text = String(input || "").trim();
  const sessionId = String((context && context.sessionId) || "unknown");

  if (!text) {
    return {
      text: [
        "请输入任务内容。",
        "示例：请帮我把 README 里 Home Assistant 章节补齐。",
        "查状态：发送“任务状态”或“status <taskId>”。",
        "确认发布：发送“确认完成 <taskId> 提交: xxx”。"
      ].join("\n")
    };
  }

  const lower = text.toLowerCase();

  if (isStatusRequest(text, lower)) {
    const taskId = extractTaskId(text);
    const task = findTaskForSession(sessionId, taskId);
    if (!task) {
      return { text: "未找到任务。请先发起 codex 任务。" };
    }
    return { text: formatTaskStatus(task) };
  }

  if (isConfirmRequest(text, lower)) {
    const taskId = extractTaskId(text);
    const task = findTaskForSession(sessionId, taskId, [
      "awaiting_confirmation",
      "finalize_failed",
      "completed",
      "succeeded"
    ]);

    if (!task) {
      return { text: "没有可确认的任务。请先执行任务并等待完成。" };
    }

    if (task.status === "running" || task.status === "queued") {
      return { text: `任务 ${task.id} 仍在执行中，请稍后查询状态。` };
    }

    if (task.status === "completed") {
      return { text: formatTaskStatus(task) };
    }

    const commitMessage = extractCommitMessage(text, task.id);
    const finalizeResult = await finalizeTask(task, commitMessage);
    return { text: finalizeResult };
  }

  const task = createTask(sessionId, text);
  runCodexTask(task);

  return {
    text: [
      `已创建任务 ${task.id}`,
      "状态：running",
      "我会持续记录关键节点。",
      `可随时发送“任务状态 ${task.id}”查看进展。`,
      "任务完成后发送“确认完成 <taskId> 提交: <commit message>”执行 git commit/push + pm2 restart 0。"
    ].join("\n")
  };
};

function ensureDirs() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CODEX_HOME_DIR, { recursive: true });
}

function loadState() {
  if (!fs.existsSync(STORE_FILE)) {
    return { tasks: {} };
  }

  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const tasks = parsed && typeof parsed === "object" && parsed.tasks && typeof parsed.tasks === "object"
      ? parsed.tasks
      : {};

    // Recover tasks that were running before process restart.
    for (const task of Object.values(tasks)) {
      if (!task || typeof task !== "object") continue;
      if (task.status === "running" || task.status === "queued") {
        task.status = "failed";
        task.updatedAt = nowIso();
        task.finishedAt = nowIso();
        pushEvent(task, "system", "任务在服务重启后中断，请重新发起。", true);
      }
    }

    return { tasks };
  } catch (_error) {
    return { tasks: {} };
  }
}

function saveState() {
  const temp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temp, STORE_FILE);
}

function nowIso() {
  return new Date().toISOString();
}

function createTask(sessionId, request) {
  const id = `codex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = nowIso();
  const task = {
    id,
    sessionId,
    request,
    status: "queued",
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
    codex: {
      outputFile: path.join(OUTPUT_DIR, `${id}.last-message.txt`),
      exitCode: null,
      signal: null,
      lastMessage: "",
      error: ""
    },
    finalize: {
      commitMessage: "",
      commitHash: "",
      pushed: false,
      restarted: false,
      error: ""
    },
    events: [],
    rawTail: []
  };

  state.tasks[id] = task;
  pushEvent(task, "task", "任务已创建", true);
  saveState();
  return task;
}

function runCodexTask(task) {
  task.status = "running";
  task.startedAt = nowIso();
  task.updatedAt = nowIso();
  pushEvent(task, "codex", "开始执行 codex-cli", true);

  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "-o",
    task.codex.outputFile,
    task.request
  ];

  pushEvent(task, "codex", `命令: codex ${args.map((arg) => safePreview(arg)).join(" ")}`, true);
  saveState();

  const child = spawn("codex", args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CODEX_HOME: CODEX_HOME_DIR
    }
  });

  runningTaskIds.add(task.id);

  const streamState = {
    stdoutBuf: "",
    stderrBuf: ""
  };

  child.stdout.on("data", (chunk) => {
    streamState.stdoutBuf = consumeStream(task, chunk.toString("utf8"), streamState.stdoutBuf, "stdout");
  });

  child.stderr.on("data", (chunk) => {
    streamState.stderrBuf = consumeStream(task, chunk.toString("utf8"), streamState.stderrBuf, "stderr");
  });

  child.on("error", (error) => {
    task.status = "failed";
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    task.codex.error = String(error && error.message ? error.message : error);
    pushEvent(task, "error", `codex 启动失败: ${task.codex.error}`, true);
    runningTaskIds.delete(task.id);
    saveState();
  });

  child.on("close", (code, signal) => {
    flushStreamTail(task, streamState, "stdout");
    flushStreamTail(task, streamState, "stderr");

    task.codex.exitCode = typeof code === "number" ? code : null;
    task.codex.signal = signal || null;
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();

    if (fs.existsSync(task.codex.outputFile)) {
      try {
        task.codex.lastMessage = fs.readFileSync(task.codex.outputFile, "utf8").trim();
      } catch (_error) {
        // Ignore read errors and keep trace in raw tail only.
      }
    }

    if (code === 0) {
      task.status = "awaiting_confirmation";
      pushEvent(task, "codex", "执行完成，等待用户确认发布", true);
    } else {
      task.status = "failed";
      const failReason = task.codex.error || `exit code ${code}${signal ? `, signal ${signal}` : ""}`;
      pushEvent(task, "error", `执行失败: ${failReason}`, true);
    }

    runningTaskIds.delete(task.id);
    saveState();
  });
}

function consumeStream(task, data, existingBuffer, channel) {
  const merged = `${existingBuffer}${data}`;
  const lines = merged.split(/\r?\n/);
  const remain = lines.pop() || "";

  for (const line of lines) {
    processOutputLine(task, line, channel);
  }

  return remain;
}

function flushStreamTail(task, streamState, channel) {
  const key = channel === "stdout" ? "stdoutBuf" : "stderrBuf";
  const value = streamState[key];
  if (value && value.trim()) {
    processOutputLine(task, value.trim(), channel);
    streamState[key] = "";
  }
}

function processOutputLine(task, line, channel) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;

  task.updatedAt = nowIso();
  pushRawLine(task, `[${channel}] ${trimmed}`);

  const parsed = tryParseJson(trimmed);
  if (!parsed || typeof parsed.type !== "string") {
    if (trimmed.toLowerCase().includes("error")) {
      pushEvent(task, "error", trimmed, false);
    }
    return;
  }

  const eventType = parsed.type;
  if (eventType === "thread.started") {
    pushEvent(task, "event", `thread started${parsed.thread_id ? ` (${parsed.thread_id})` : ""}`, false);
    return;
  }
  if (eventType === "turn.started") {
    pushEvent(task, "event", "turn started", false);
    return;
  }
  if (eventType === "turn.completed") {
    pushEvent(task, "event", "turn completed", false);
    return;
  }
  if (eventType === "turn.failed") {
    const reason = parsed.error && parsed.error.message ? parsed.error.message : "turn failed";
    task.codex.error = String(reason);
    pushEvent(task, "error", String(reason), true);
    return;
  }
  if (eventType === "error") {
    const message = parsed.message ? String(parsed.message) : "unknown error";
    task.codex.error = message;
    pushEvent(task, "error", message, true);
    return;
  }

  if (eventType.startsWith("agent_message") || eventType.includes("completed")) {
    pushEvent(task, "event", eventType, false);
  }
}

function tryParseJson(line) {
  if (!line.startsWith("{") || !line.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function pushRawLine(task, line) {
  task.rawTail.push({ at: nowIso(), line: line.slice(0, 600) });
  if (task.rawTail.length > MAX_RAW_LINES) {
    task.rawTail = task.rawTail.slice(task.rawTail.length - MAX_RAW_LINES);
  }
}

function pushEvent(task, stage, message, important) {
  const text = String(message || "").slice(0, 500);
  task.events.push({ at: nowIso(), stage, message: text, important: !!important });
  if (task.events.length > MAX_EVENTS) {
    task.events = task.events.slice(task.events.length - MAX_EVENTS);
  }
}

function safePreview(text) {
  const value = String(text);
  if (/^[a-zA-Z0-9._\/-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function isStatusRequest(text, lower) {
  if (lower.startsWith("status")) return true;
  if (text.includes("任务状态") || text.includes("查状态") || text.includes("进度")) return true;
  if (text.includes("状态") && (text.includes("任务") || text.includes("codex"))) return true;
  return false;
}

function isConfirmRequest(text, lower) {
  if (lower.startsWith("confirm")) return true;
  if (text.includes("确认完成") || text.includes("确认任务") || text.includes("确认发布")) return true;
  if (text.includes("完成并发布") || text.includes("确认") && text.includes("提交")) return true;
  return false;
}

function extractTaskId(text) {
  const matched = String(text).match(/codex-[a-z0-9-]{6,}/i);
  return matched ? matched[0].toLowerCase() : undefined;
}

function extractCommitMessage(text, taskId) {
  const raw = String(text || "");
  const match = raw.match(/(?:提交|commit)\s*[:：]\s*(.+)$/i);
  if (match && match[1] && match[1].trim()) {
    return match[1].trim().slice(0, 120);
  }
  return `chore: apply ${taskId} via wecom-codex-operator`;
}

function findTaskForSession(sessionId, taskId, preferredStatuses) {
  if (taskId) {
    const task = state.tasks[taskId];
    if (!task) return null;
    if (task.sessionId !== sessionId) return null;
    if (Array.isArray(preferredStatuses) && preferredStatuses.length > 0 && !preferredStatuses.includes(task.status)) {
      return null;
    }
    return task;
  }

  const tasks = Object.values(state.tasks)
    .filter((task) => task && task.sessionId === sessionId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  if (!Array.isArray(preferredStatuses) || preferredStatuses.length === 0) {
    return tasks[0] || null;
  }

  return tasks.find((task) => preferredStatuses.includes(task.status)) || tasks[0] || null;
}

function formatTaskStatus(task) {
  const importantEvents = task.events.filter((event) => event.important).slice(-MAX_DISPLAY_EVENTS);
  const displayedEvents = importantEvents.length > 0
    ? importantEvents
    : task.events.slice(-MAX_DISPLAY_EVENTS);

  const eventText = displayedEvents.length > 0
    ? displayedEvents.map((event) => `- [${event.at}] ${event.stage}: ${event.message}`).join("\n")
    : "- (暂无节点)";

  const tail = task.rawTail.slice(-MAX_DISPLAY_LINES).map((item) => `- [${item.at}] ${item.line}`).join("\n");
  const tailText = tail || "- (暂无输出)";

  const blocks = [
    `任务ID: ${task.id}`,
    `状态: ${task.status}`,
    `创建时间: ${task.createdAt}`,
    task.startedAt ? `开始时间: ${task.startedAt}` : "开始时间: -",
    task.finishedAt ? `结束时间: ${task.finishedAt}` : "结束时间: -",
    "",
    "关键节点:",
    eventText,
    "",
    "最近输出:",
    tailText
  ];

  if (task.codex.lastMessage) {
    blocks.push("", "codex 最终输出:", trimForDisplay(task.codex.lastMessage, 1200));
  }

  if (task.status === "awaiting_confirmation") {
    blocks.push(
      "",
      "可执行发布：",
      `发送“确认完成 ${task.id} 提交: <commit message>”执行 git commit/push + pm2 restart 0。`
    );
  }

  if (task.status === "failed") {
    blocks.push("", `失败原因: ${task.codex.error || "请查看最近输出"}`);
  }

  if (task.status === "completed") {
    blocks.push(
      "",
      `发布结果: commit=${task.finalize.commitHash || "unknown"}, push=${task.finalize.pushed}, pm2=${task.finalize.restarted}`
    );
  }

  if (task.status === "finalize_failed") {
    blocks.push("", `发布失败: ${task.finalize.error || "未知错误"}`);
  }

  return blocks.join("\n");
}

function trimForDisplay(text, maxLength) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

async function finalizeTask(task, commitMessage) {
  task.status = "finalizing";
  task.updatedAt = nowIso();
  task.finalize.commitMessage = commitMessage;
  task.finalize.error = "";
  pushEvent(task, "finalize", `开始发布，commit message: ${commitMessage}`, true);
  saveState();

  try {
    await runStep(task, "git", ["add", "-A"], 120000);
    await runStep(task, "git", ["commit", "--allow-empty", "-m", commitMessage], 120000);
    const hashResult = await runStep(task, "git", ["rev-parse", "--short", "HEAD"], 20000);
    task.finalize.commitHash = (hashResult.stdout || "").trim();

    await runStep(task, "git", ["push"], 180000);
    task.finalize.pushed = true;

    await runStep(task, "pm2", ["restart", "0"], 120000);
    task.finalize.restarted = true;

    task.status = "completed";
    task.updatedAt = nowIso();
    pushEvent(task, "finalize", `发布完成 commit=${task.finalize.commitHash || "unknown"}`, true);
    saveState();

    return [
      `任务 ${task.id} 发布完成。`,
      `commit: ${task.finalize.commitHash || "unknown"}`,
      "git push: success",
      "pm2 restart 0: success"
    ].join("\n");
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    task.status = "finalize_failed";
    task.updatedAt = nowIso();
    task.finalize.error = message;
    pushEvent(task, "error", `发布失败: ${message}`, true);
    saveState();

    return [
      `任务 ${task.id} 发布失败。`,
      `错误: ${message}`,
      `可发送“任务状态 ${task.id}”查看详情。`
    ].join("\n");
  }
}

function runStep(task, command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    pushEvent(task, "cmd", `${command} ${args.map((arg) => safePreview(arg)).join(" ")}`, true);
    saveState();

    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGKILL");
      reject(new Error(`${command} 超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const out = stdout.trim();
      const err = stderr.trim();
      if (out) pushRawLine(task, `[${command} stdout] ${trimForDisplay(out, 2000)}`);
      if (err) pushRawLine(task, `[${command} stderr] ${trimForDisplay(err, 2000)}`);

      if (code === 0) {
        resolve({ stdout: out, stderr: err, code });
        return;
      }

      const reason = err || out || `${command} exited with code ${code}`;
      reject(new Error(reason));
    });
  });
}
