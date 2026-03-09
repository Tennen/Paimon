import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { ensureDir, resolveDataPath } from "../../storage/persistence";

export type CodexRunRequest = {
  taskId: string;
  prompt: string;
  timeoutMs?: number;
  model?: string;
  reasoningEffort?: string;
  onEvent?: (event: CodexRunEvent) => void;
};

export type CodexRunResult = {
  ok: boolean;
  output: string;
  error?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  rateLimited: boolean;
  rawTail: string[];
};

export type CodexRunEvent =
  | {
      type: "started";
      at: string;
      taskId: string;
      outputFile: string;
      timeoutMs: number;
    }
  | {
      type: "stdout" | "stderr";
      at: string;
      line: string;
    }
  | {
      type: "approval_required";
      at: string;
      taskId: string;
      prompt: string;
    }
  | {
      type: "approval_submitted";
      at: string;
      taskId: string;
      decision: "yes" | "no";
    }
  | {
      type: "timeout";
      at: string;
      timeoutMs: number;
    }
  | {
      type: "error";
      at: string;
      message: string;
    }
  | {
      type: "closed";
      at: string;
      code: number | null;
      signal: NodeJS.Signals | null;
      ok: boolean;
    };

type CodexAdapterOptions = {
  rootDir: string;
  outputDir: string;
  timeoutMs: number;
  maxRawLines: number;
  model: string;
  reasoningEffort: string;
  approvalPolicy: string;
};

export type CodexPendingApproval = {
  taskId: string;
  at: string;
  prompt: string;
};

type ActiveCodexRun = {
  stdin: NodeJS.WritableStream | null;
  onEvent?: CodexRunRequest["onEvent"];
};

export class CodexAdapter {
  private readonly options: CodexAdapterOptions;
  private readonly pendingApprovals = new Map<string, CodexPendingApproval>();
  private readonly activeRuns = new Map<string, ActiveCodexRun>();

  constructor(options?: Partial<CodexAdapterOptions>) {
    const rootDir = options?.rootDir ?? process.cwd();
    const outputDir = options?.outputDir ?? resolveDataPath("evolution", "codex");
    this.options = {
      rootDir,
      outputDir,
      timeoutMs: options?.timeoutMs ?? parseInt(process.env.EVOLUTION_CODEX_TIMEOUT_MS ?? "900000", 10),
      maxRawLines: options?.maxRawLines ?? 120,
      model: String(options?.model ?? "").trim(),
      reasoningEffort: String(options?.reasoningEffort ?? "").trim().toLowerCase(),
      approvalPolicy: normalizeApprovalPolicy(
        options?.approvalPolicy ?? process.env.EVOLUTION_CODEX_APPROVAL_POLICY ?? process.env.CODEX_APPROVAL_POLICY
      )
    };
    ensureDir(this.options.outputDir);
  }

  listPendingApprovals(): CodexPendingApproval[] {
    return Array.from(this.pendingApprovals.values()).sort((left, right) => {
      return Date.parse(left.at) - Date.parse(right.at);
    });
  }

  submitApproval(input: { taskId: string; decision: "yes" | "no" }): { ok: boolean; message: string } {
    const taskId = sanitizeTaskId(input.taskId);
    const pending = this.pendingApprovals.get(taskId);
    if (!pending) {
      return {
        ok: false,
        message: `未找到待确认任务: ${taskId}`
      };
    }

    const active = this.activeRuns.get(taskId);
    if (!active?.stdin) {
      this.pendingApprovals.delete(taskId);
      return {
        ok: false,
        message: `任务 ${taskId} 不可写入确认（可能已结束）`
      };
    }

    try {
      const payload = input.decision === "yes" ? "y\n" : "n\n";
      active.stdin.write(payload);
      this.pendingApprovals.delete(taskId);
      emitCodexEvent(active.onEvent, {
        type: "approval_submitted",
        at: nowIso(),
        taskId,
        decision: input.decision
      });
      return {
        ok: true,
        message: `已提交确认: ${taskId} -> ${input.decision}`
      };
    } catch (error) {
      return {
        ok: false,
        message: `提交确认失败: ${(error as Error).message}`
      };
    }
  }

  async run(request: CodexRunRequest): Promise<CodexRunResult> {
    const taskId = sanitizeTaskId(request.taskId);
    const outputFile = path.join(this.options.outputDir, `${taskId}.txt`);
    const timeoutMs = Number.isFinite(request.timeoutMs) ? Number(request.timeoutMs) : this.options.timeoutMs;
    const rawTail: string[] = [];
    const onLine = (channel: "stdout" | "stderr", line: string) => {
      this.captureApprovalPrompt(taskId, line, request.onEvent);
      emitCodexEvent(request.onEvent, {
        type: channel,
        at: nowIso(),
        line
      });
    };

    const args = [
      "-a",
      this.options.approvalPolicy,
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "-o",
      outputFile,
      request.prompt
    ];
    const model = resolveCodexModel(request.model, this.options.model);
    if (model) {
      args.splice(args.length - 1, 0, "--model", model);
    }
    const reasoningEffort = resolveCodexReasoningEffort(request.reasoningEffort, this.options.reasoningEffort);
    if (reasoningEffort) {
      args.splice(args.length - 1, 0, "--config", `model_reasoning_effort=${formatTomlString(reasoningEffort)}`);
    }

    return new Promise((resolve) => {
      emitCodexEvent(request.onEvent, {
        type: "started",
        at: nowIso(),
        taskId,
        outputFile,
        timeoutMs
      });
      this.pendingApprovals.delete(taskId);

      const child = spawn("codex", args, {
        cwd: this.options.rootDir,
        env: process.env
      });
      this.activeRuns.set(taskId, {
        stdin: child.stdin,
        onEvent: request.onEvent
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let finished = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (finished) return;
        finished = true;
        child.kill("SIGKILL");
        emitCodexEvent(request.onEvent, {
          type: "timeout",
          at: nowIso(),
          timeoutMs
        });
        flushRemainingBuffer(rawTail, stdoutBuffer, "stdout", this.options.maxRawLines, onLine);
        flushRemainingBuffer(rawTail, stderrBuffer, "stderr", this.options.maxRawLines, onLine);
        this.cleanupTask(taskId);
        resolve(buildResult({
          ok: false,
          outputFile,
          error: `codex timeout after ${timeoutMs}ms`,
          exitCode: null,
          signal: "SIGKILL",
          rawTail
        }));
      }, Math.max(1000, timeoutMs));

      child.stdout.on("data", (chunk) => {
        stdoutBuffer = consumeStreamBuffer(
          rawTail,
          stdoutBuffer,
          chunk.toString("utf8"),
          "stdout",
          this.options.maxRawLines,
          onLine
        );
      });

      child.stderr.on("data", (chunk) => {
        stderrBuffer = consumeStreamBuffer(
          rawTail,
          stderrBuffer,
          chunk.toString("utf8"),
          "stderr",
          this.options.maxRawLines,
          onLine
        );
      });

      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        emitCodexEvent(request.onEvent, {
          type: "error",
          at: nowIso(),
          message: `codex spawn failed: ${(error as Error).message}`
        });
        flushRemainingBuffer(rawTail, stdoutBuffer, "stdout", this.options.maxRawLines, onLine);
        flushRemainingBuffer(rawTail, stderrBuffer, "stderr", this.options.maxRawLines, onLine);
        this.cleanupTask(taskId);
        resolve(buildResult({
          ok: false,
          outputFile,
          error: `codex spawn failed: ${(error as Error).message}`,
          exitCode: null,
          signal: null,
          rawTail
        }));
      });

      child.on("close", (code, signal) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);

        flushRemainingBuffer(rawTail, stdoutBuffer, "stdout", this.options.maxRawLines, onLine);
        flushRemainingBuffer(rawTail, stderrBuffer, "stderr", this.options.maxRawLines, onLine);

        const error = timedOut
          ? `codex timeout after ${timeoutMs}ms`
          : code === 0
            ? ""
            : `codex exited with code ${code}${signal ? ` (signal ${signal})` : ""}`;

        emitCodexEvent(request.onEvent, {
          type: "closed",
          at: nowIso(),
          code: typeof code === "number" ? code : null,
          signal,
          ok: code === 0 && !timedOut
        });
        this.cleanupTask(taskId);

        resolve(
          buildResult({
            ok: code === 0 && !timedOut,
            outputFile,
            error,
            exitCode: typeof code === "number" ? code : null,
            signal,
            rawTail
          })
        );
      });
    });
  }

  private cleanupTask(taskId: string): void {
    this.activeRuns.delete(taskId);
    this.pendingApprovals.delete(taskId);
  }

  private captureApprovalPrompt(taskId: string, line: string, listener?: CodexRunRequest["onEvent"]): void {
    const prompt = detectApprovalPrompt(line);
    if (!prompt) {
      return;
    }

    const existing = this.pendingApprovals.get(taskId);
    if (existing && existing.prompt === prompt) {
      return;
    }

    const pending: CodexPendingApproval = {
      taskId,
      at: nowIso(),
      prompt: prompt.slice(0, 500)
    };
    this.pendingApprovals.set(taskId, pending);
    emitCodexEvent(listener, {
      type: "approval_required",
      at: pending.at,
      taskId: pending.taskId,
      prompt: pending.prompt
    });
  }
}

function consumeStreamBuffer(
  rawTail: string[],
  buffer: string,
  chunk: string,
  channel: "stdout" | "stderr",
  maxRawLines: number,
  onLine?: (channel: "stdout" | "stderr", line: string) => void
): string {
  const merged = `${buffer}${chunk}`;
  const parts = merged.split(/\r?\n/);
  const remain = parts.pop() ?? "";
  for (const line of parts) {
    pushRawLine(rawTail, line, channel, maxRawLines, onLine);
  }
  return remain;
}

function flushRemainingBuffer(
  rawTail: string[],
  buffer: string,
  channel: "stdout" | "stderr",
  maxRawLines: number,
  onLine?: (channel: "stdout" | "stderr", line: string) => void
): void {
  const line = buffer.trim();
  if (!line) {
    return;
  }
  pushRawLine(rawTail, line, channel, maxRawLines, onLine);
}

function pushRawLine(
  rawTail: string[],
  line: string,
  channel: "stdout" | "stderr",
  maxRawLines: number,
  onLine?: (channel: "stdout" | "stderr", line: string) => void
): void {
  const text = String(line ?? "").trim();
  if (!text) {
    return;
  }
  const clipped = text.slice(0, 800);
  rawTail.push(`[${channel}] ${clipped}`);
  if (onLine) {
    onLine(channel, clipped);
  }
  if (rawTail.length > maxRawLines) {
    rawTail.splice(0, rawTail.length - maxRawLines);
  }
}

function buildResult(input: {
  ok: boolean;
  outputFile: string;
  error: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  rawTail: string[];
}): CodexRunResult {
  const output = readOutputFile(input.outputFile);
  const mergedText = [output, input.error, ...input.rawTail].join("\n");
  const rateLimited = detectRateLimit(mergedText);

  return {
    ok: input.ok,
    output,
    ...(input.error ? { error: input.error } : {}),
    exitCode: input.exitCode,
    signal: input.signal,
    rateLimited,
    rawTail: input.rawTail.slice()
  };
}

function readOutputFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

function detectRateLimit(text: string): boolean {
  const lower = String(text ?? "").toLowerCase();
  if (!lower) {
    return false;
  }
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota")
  );
}

function sanitizeTaskId(input: string): string {
  const cleaned = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return cleaned || `task-${Date.now()}`;
}

function emitCodexEvent(listener: CodexRunRequest["onEvent"], event: CodexRunEvent): void {
  if (!listener) {
    return;
  }
  try {
    listener(event);
  } catch {
    // ignore listener errors
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveCodexModel(...candidates: Array<string | undefined>): string {
  const fromOptions = candidates.find((item) => typeof item === "string" && item.trim().length > 0);
  if (fromOptions) {
    return fromOptions.trim();
  }
  const fromEnv = String(process.env.EVOLUTION_CODEX_MODEL ?? process.env.CODEX_MODEL ?? "").trim();
  return fromEnv;
}

function resolveCodexReasoningEffort(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const normalized = normalizeReasoningEffort(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return normalizeReasoningEffort(
    process.env.EVOLUTION_CODEX_REASONING_EFFORT
      ?? process.env.CODEX_MODEL_REASONING_EFFORT
      ?? process.env.CODEX_REASONING_EFFORT
  );
}

function normalizeApprovalPolicy(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "untrusted" || text === "on-request" || text === "on-failure" || text === "never") {
    return text;
  }
  return "on-request";
}

function normalizeReasoningEffort(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  return text;
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function detectApprovalPrompt(line: string): string | null {
  const text = String(line ?? "").trim();
  if (!text) {
    return null;
  }

  const fromJson = detectApprovalPromptFromJson(text);
  if (fromJson) {
    return fromJson;
  }

  if (/\[(?:y\/n|y\/N|Y\/n|Y\/N|yes\/no|Yes\/No)\]/.test(text)) {
    return text;
  }
  if (/\b(approve|approval|confirm|permission|allow)\b/i.test(text)) {
    return text;
  }
  if (/(确认|批准|同意|拒绝|是否继续)/.test(text)) {
    return text;
  }
  return null;
}

function detectApprovalPromptFromJson(text: string): string | null {
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const type = String(parsed.type ?? "").toLowerCase();
  const message = readPromptText(parsed);

  if (type.includes("approval") || type.includes("confirm")) {
    if (message) {
      return message;
    }
    return `等待确认事件: ${type}`;
  }

  if (message && /\b(approve|approval|confirm|permission|allow)\b/i.test(message)) {
    return message;
  }
  if (message && /(确认|批准|同意|拒绝|是否继续)/.test(message)) {
    return message;
  }

  const item = isRecord(parsed.item) ? parsed.item : null;
  if (item) {
    const itemType = String(item.type ?? "").toLowerCase();
    const itemMessage = readPromptText(item);
    if (itemType.includes("approval") || itemType.includes("confirm")) {
      return itemMessage || `等待确认事件: ${itemType}`;
    }
    if (itemMessage && /\b(approve|approval|confirm|permission|allow)\b/i.test(itemMessage)) {
      return itemMessage;
    }
  }

  return null;
}

function readPromptText(obj: Record<string, unknown>): string {
  const candidates: unknown[] = [
    obj.prompt,
    obj.message,
    obj.reason,
    obj.detail,
    isRecord(obj.error) ? obj.error.message : undefined
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
