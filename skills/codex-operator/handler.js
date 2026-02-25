const DEFAULT_PORT = process.env.PORT || "3000";
const BASE_URL = (process.env.EVOLUTION_ADMIN_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = toInt(process.env.CODEX_OPERATOR_TIMEOUT_MS, 12000);
const ALLOWED_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const RESET_TOKENS = new Set(["default", "reset", "clear", "none", "空", "默认"]);

module.exports.directCommands = ["/codex"];

module.exports.execute = async function execute(input) {
  const command = parseCommand(input);

  if (command.kind === "help") {
    return { text: buildHelpText() };
  }

  if (command.kind === "status") {
    const config = await fetchConfig();
    return { text: formatStatus(config) };
  }

  if (command.kind === "model_get") {
    const config = await fetchConfig();
    return { text: `Codex model: ${config.codexModel || "(default)"}` };
  }

  if (command.kind === "model_set") {
    const payload = await updateCodexConfig({
      model: command.model
    });
    return {
      text: [
        "Codex model 已更新。",
        `当前 model: ${payload.codexModel || "(default)"}`,
        `当前 reasoning effort: ${payload.codexReasoningEffort || "(default)"}`
      ].join("\n")
    };
  }

  if (command.kind === "effort_get") {
    const config = await fetchConfig();
    return { text: `Codex reasoning effort: ${config.codexReasoningEffort || "(default)"}` };
  }

  if (command.kind === "effort_set") {
    const payload = await updateCodexConfig({
      reasoningEffort: command.reasoningEffort
    });
    return {
      text: [
        "Codex reasoning effort 已更新。",
        `当前 reasoning effort: ${payload.codexReasoningEffort || "(default)"}`,
        `当前 model: ${payload.codexModel || "(default)"}`
      ].join("\n")
    };
  }

  return { text: buildHelpText() };
};

function parseCommand(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return { kind: "help" };
  }

  let body = raw;
  const prefixMatch = raw.match(/^\/codex\b/i);
  if (prefixMatch) {
    body = raw.slice(prefixMatch[0].length).trim();
  }

  if (!body) {
    return { kind: "status" };
  }

  if (/^(help|h|\?|帮助)$/i.test(body)) {
    return { kind: "help" };
  }

  if (/^(status|state|show|list|ls|查询|查看|状态)$/i.test(body)) {
    return { kind: "status" };
  }

  const modelMatch = body.match(/^(model|模型)\b\s*(.*)$/i);
  if (modelMatch) {
    const value = normalizeModelValue(modelMatch[2] || "");
    if (value === null) {
      return { kind: "model_get" };
    }
    return { kind: "model_set", model: value };
  }

  const effortMatch = body.match(/^(effort|reasoning|reasoning-effort|推理|强度)\b\s*(.*)$/i);
  if (effortMatch) {
    const parsed = normalizeEffortValue(effortMatch[2] || "");
    if (parsed.kind === "invalid") {
      throw new Error("reasoning effort 仅支持: minimal, low, medium, high, xhigh");
    }
    if (parsed.kind === "empty") {
      return { kind: "effort_get" };
    }
    return { kind: "effort_set", reasoningEffort: parsed.value };
  }

  return { kind: "help" };
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

function normalizeEffortValue(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) {
    return { kind: "empty" };
  }
  if (RESET_TOKENS.has(text)) {
    return { kind: "value", value: "" };
  }
  if (!ALLOWED_EFFORTS.has(text)) {
    return { kind: "invalid" };
  }
  return { kind: "value", value: text };
}

function buildHelpText() {
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

function formatStatus(config) {
  return [
    "Codex 当前配置：",
    `model: ${config.codexModel || "(default)"}`,
    `reasoning effort: ${config.codexReasoningEffort || "(default)"}`,
    `env: ${config.envPath || "-"}`
  ].join("\n");
}

async function fetchConfig() {
  const payload = await requestJson("/admin/api/config", {
    method: "GET"
  });
  return {
    codexModel: toText(payload.codexModel),
    codexReasoningEffort: toText(payload.codexReasoningEffort),
    envPath: toText(payload.envPath)
  };
}

async function updateCodexConfig(input) {
  const payload = await requestJson("/admin/api/config/codex", {
    method: "POST",
    body: {
      ...(Object.prototype.hasOwnProperty.call(input, "model") ? { model: input.model } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "reasoningEffort") ? { reasoningEffort: input.reasoningEffort } : {})
    }
  });

  return {
    codexModel: toText(payload.codexModel),
    codexReasoningEffort: toText(payload.codexReasoningEffort)
  };
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
      throw new Error(`codex-operator request failed: ${detail}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function toText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
