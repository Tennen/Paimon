import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { InternalChatRequest, LLMChatEngine } from "../chat_engine";
import { LLMExecutionStep } from "../llm";
import { ensureDir, resolveDataPath } from "../../../storage/persistence";

export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type CodexLLMOptions = {
  model: string;
  planningModel: string;
  reasoningEffort: CodexReasoningEffort | "";
  planningReasoningEffort: CodexReasoningEffort | "";
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  rootDir: string;
  outputDir: string;
};

type CodexExecutionResult = {
  ok: boolean;
  output: string;
  error: string;
};

const DEFAULT_MODEL = "gpt-5-codex";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_STRICT_JSON = true;
const DEFAULT_APPROVAL_POLICY: CodexApprovalPolicy = "never";
const DEFAULT_SANDBOX: CodexSandboxMode = "read-only";
const ALLOWED_REASONING_EFFORT = new Set<CodexReasoningEffort>(["minimal", "low", "medium", "high", "xhigh"]);

export class CodexLLMEngine extends LLMChatEngine {
  private readonly options: CodexLLMOptions;

  constructor(options?: Partial<CodexLLMOptions>) {
    const model = resolveFirstText(
      options?.model,
      process.env.LLM_CODEX_MODEL,
      process.env.CODEX_MODEL,
      process.env.EVOLUTION_CODEX_MODEL,
      process.env.LLM_MODEL,
      DEFAULT_MODEL
    ) || DEFAULT_MODEL;
    const planningModel = resolveFirstText(
      options?.planningModel,
      process.env.LLM_CODEX_PLANNING_MODEL,
      model
    ) || model;
    const timeoutMs = parsePositiveInteger(options?.timeoutMs ?? process.env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const planningTimeoutMs = parsePositiveInteger(options?.planningTimeoutMs ?? process.env.LLM_PLANNING_TIMEOUT_MS, timeoutMs);
    const maxRetries = parsePositiveInteger(options?.maxRetries ?? process.env.LLM_MAX_RETRIES, DEFAULT_MAX_RETRIES);
    const strictJson = parseBoolean(options?.strictJson ?? process.env.LLM_STRICT_JSON, DEFAULT_STRICT_JSON);

    super({ maxRetries, strictJson });

    this.options = {
      model,
      planningModel,
      reasoningEffort: normalizeReasoningEffort(
        options?.reasoningEffort,
        process.env.LLM_CODEX_REASONING_EFFORT,
        process.env.CODEX_MODEL_REASONING_EFFORT,
        process.env.CODEX_REASONING_EFFORT,
        process.env.EVOLUTION_CODEX_REASONING_EFFORT
      ),
      planningReasoningEffort: normalizeReasoningEffort(
        options?.planningReasoningEffort,
        process.env.LLM_CODEX_PLANNING_REASONING_EFFORT
      ),
      timeoutMs,
      planningTimeoutMs,
      maxRetries,
      strictJson,
      approvalPolicy: normalizeApprovalPolicy(options?.approvalPolicy ?? process.env.LLM_CODEX_APPROVAL_POLICY),
      sandbox: normalizeSandbox(options?.sandbox ?? process.env.LLM_CODEX_SANDBOX),
      rootDir: resolveFirstText(options?.rootDir, process.cwd()) || process.cwd(),
      outputDir: resolveFirstText(options?.outputDir, resolveDataPath("llm", "codex")) || resolveDataPath("llm", "codex")
    };

    ensureDir(this.options.outputDir);
  }

  getModelForStep(step: LLMExecutionStep): string {
    return step === "planning" ? this.options.planningModel : this.options.model;
  }

  getProviderName(): "codex" {
    return "codex";
  }

  protected async executeChat(request: InternalChatRequest): Promise<string> {
    const isPlanning = request.step === "planning";
    const timeoutMs = request.timeoutMs ?? (isPlanning ? this.options.planningTimeoutMs : this.options.timeoutMs);
    const taskId = buildTaskId(request.step);
    const outputFile = path.join(this.options.outputDir, `${taskId}.txt`);
    const reasoningEffort = normalizeReasoningEffort(
      readReasoningEffortOption(request.options),
      isPlanning
        ? (this.options.planningReasoningEffort || this.options.reasoningEffort)
        : this.options.reasoningEffort
    );

    const prompt = buildCodexPrompt(request);
    const args = buildCodexArgs({
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      outputFile,
      prompt,
      model: request.model,
      reasoningEffort
    });
    const startedAt = Date.now();
    const outputFileName = path.basename(outputFile);

    console.log(
      `[LLM][codex][exec:${request.step}] start model=${request.model || "unknown"} timeout=${timeoutMs}ms reasoning=${reasoningEffort || "default"} output_file=${outputFileName}`
    );
    const result = await runCodexCommand(args, {
      cwd: this.options.rootDir,
      timeoutMs,
      outputFile
    });

    if (!result.ok) {
      console.error(
        `[LLM][codex][exec:${request.step}] failed model=${request.model || "unknown"} duration=${Date.now() - startedAt}ms output_file=${outputFileName} error=${result.error || "codex execution failed"}`
      );
      throw new Error(result.error || "codex execution failed");
    }

    const output = String(result.output ?? "").trim();
    if (!output) {
      console.error(
        `[LLM][codex][exec:${request.step}] failed model=${request.model || "unknown"} duration=${Date.now() - startedAt}ms output_file=${outputFileName} error=codex returned empty response`
      );
      throw new Error("codex returned empty response");
    }
    console.log(
      `[LLM][codex][exec:${request.step}] success model=${request.model || "unknown"} duration=${Date.now() - startedAt}ms output_file=${outputFileName} output_chars=${output.length}`
    );
    return output;
  }
}

function buildCodexPrompt(request: InternalChatRequest): string {
  const messageText = request.messages
    .map((message, index) => formatMessageForPrompt(index + 1, message))
    .join("\n\n");

  return [
    "You are acting as an LLM backend for an automation runtime.",
    "Read the provided conversation messages and output only the assistant reply body.",
    "Do not execute side-effectful operations and do not modify workspace files.",
    "If the messages require strict JSON, output strict JSON only.",
    "Do not output markdown fences.",
    `step: ${request.step}`,
    `model_hint: ${request.model}`,
    "",
    "<messages>",
    messageText,
    "</messages>"
  ].join("\n");
}

function formatMessageForPrompt(
  index: number,
  message: { role: "system" | "user" | "assistant"; content: string; images?: string[] }
): string {
  const images = Array.isArray(message.images)
    ? message.images.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];
  const lines = [
    `#${index} role=${message.role}`,
    String(message.content ?? "")
  ];
  if (images.length > 0) {
    lines.push(`[images: ${images.length}]`);
  }
  return lines.join("\n");
}

function buildCodexArgs(input: {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  outputFile: string;
  prompt: string;
  model: string;
  reasoningEffort: CodexReasoningEffort | "";
}): string[] {
  const args = [
    "-a",
    input.approvalPolicy,
    "exec",
    "--json",
    "--sandbox",
    input.sandbox,
    "-o",
    input.outputFile,
    input.prompt
  ];

  const model = String(input.model ?? "").trim();
  if (model) {
    args.splice(args.length - 1, 0, "--model", model);
  }

  if (input.reasoningEffort) {
    args.splice(args.length - 1, 0, "--config", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`);
  }

  return args;
}

async function runCodexCommand(
  args: string[],
  options: { cwd: string; timeoutMs: number; outputFile: string }
): Promise<CodexExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timeoutMs = Math.max(1000, options.timeoutMs);
    const taskRef = path.basename(options.outputFile);

    console.log(
      `[LLM][codex][cli] spawn task=${taskRef} timeout=${timeoutMs}ms ${summarizeCodexArgs(args)}`
    );

    const child = spawn("codex", args, {
      cwd: options.cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      console.error(`[LLM][codex][cli] timeout task=${taskRef} duration=${Date.now() - startedAt}ms`);
      resolve({
        ok: false,
        output: "",
        error: `codex timeout after ${timeoutMs}ms`
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      const message = code === "ENOENT"
        ? "codex CLI not found in PATH"
        : `codex spawn failed: ${(error as Error).message}`;
      console.error(`[LLM][codex][cli] spawn_failed task=${taskRef} duration=${Date.now() - startedAt}ms error=${message}`);
      resolve({
        ok: false,
        output: "",
        error: message
      });
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const fileOutput = readTextFile(options.outputFile);
      const output = fileOutput || extractCodexTextFromStdout(stdout);
      const outputSource = fileOutput ? "file" : "stdout";
      if (code === 0 && output) {
        console.log(
          `[LLM][codex][cli] success task=${taskRef} code=0 duration=${Date.now() - startedAt}ms output_source=${outputSource} output_chars=${output.length}`
        );
        resolve({ ok: true, output, error: "" });
        return;
      }

      const detail = [
        code === 0 ? "" : `code=${String(code ?? "null")}`,
        signal ? `signal=${signal}` : "",
        stderr ? `stderr=${truncateText(stderr, 320)}` : "",
        stdout ? `stdout=${truncateText(stdout, 320)}` : ""
      ]
        .filter(Boolean)
        .join(" | ");

      console.error(
        `[LLM][codex][cli] failed task=${taskRef} duration=${Date.now() - startedAt}ms${detail ? ` detail=${detail}` : ""}`
      );

      resolve({
        ok: false,
        output: output || "",
        error: `codex exec failed${detail ? ` (${detail})` : ""}`
      });
    });
  });
}

function readTextFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

function extractCodexTextFromStdout(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const parsed = parseLineAsRecord(line);
    if (!parsed) {
      continue;
    }
    const content = readCandidateText(parsed);
    if (content) {
      return content;
    }
  }

  return "";
}

function parseLineAsRecord(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{") || !line.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readCandidateText(record: Record<string, unknown>): string {
  const direct = [
    record.output,
    record.response,
    record.text,
    record.content,
    record.message,
    record.final
  ];
  for (const candidate of direct) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const item = isRecord(record.item) ? record.item : null;
  if (item) {
    const nested = readCandidateText(item);
    if (nested) {
      return nested;
    }
  }

  return "";
}

function readReasoningEffortOption(options: Record<string, unknown> | undefined): string | undefined {
  if (!options) {
    return undefined;
  }
  const candidate = options.reasoningEffort ?? options.reasoning_effort ?? options.model_reasoning_effort;
  if (typeof candidate !== "string") {
    return undefined;
  }
  return candidate;
}

function normalizeReasoningEffort(...values: Array<unknown>): CodexReasoningEffort | "" {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (ALLOWED_REASONING_EFFORT.has(normalized as CodexReasoningEffort)) {
      return normalized as CodexReasoningEffort;
    }
  }
  return "";
}

function normalizeApprovalPolicy(value: unknown): CodexApprovalPolicy {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "on-request" || normalized === "on-failure" || normalized === "never" || normalized === "untrusted") {
    return normalized;
  }
  return DEFAULT_APPROVAL_POLICY;
}

function normalizeSandbox(value: unknown): CodexSandboxMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "read-only" || normalized === "workspace-write" || normalized === "danger-full-access") {
    return normalized;
  }
  return DEFAULT_SANDBOX;
}

function parsePositiveInteger(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveFirstText(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function buildTaskId(step: string): string {
  const safeStep = String(step ?? "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "general";
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `llm-${safeStep}-${nonce}`;
}

function summarizeCodexArgs(args: string[]): string {
  const summary: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] ?? "");
    if (token === "--json") {
      summary.push("json=true");
      continue;
    }
    if ((token === "--model" || token === "--sandbox" || token === "-a" || token === "--config") && i + 1 < args.length) {
      const key = token === "--model"
        ? "model"
        : token === "--sandbox"
          ? "sandbox"
          : token === "-a"
            ? "approval"
            : "config";
      summary.push(`${key}=${truncateText(String(args[i + 1] ?? ""), 80)}`);
      i += 1;
      continue;
    }
  }

  return summary.join(" ");
}

function truncateText(text: string, maxLength: number): string {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
