import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export type CodexRunRequest = {
  taskId: string;
  prompt: string;
  timeoutMs?: number;
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

type CodexAdapterOptions = {
  rootDir: string;
  outputDir: string;
  timeoutMs: number;
  maxRawLines: number;
};

export class CodexAdapter {
  private readonly options: CodexAdapterOptions;

  constructor(options?: Partial<CodexAdapterOptions>) {
    const rootDir = options?.rootDir ?? process.cwd();
    const outputDir = options?.outputDir ?? path.resolve(process.cwd(), "state", "codex");
    this.options = {
      rootDir,
      outputDir,
      timeoutMs: options?.timeoutMs ?? parseInt(process.env.EVOLUTION_CODEX_TIMEOUT_MS ?? "900000", 10),
      maxRawLines: options?.maxRawLines ?? 120
    };
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
  }

  async run(request: CodexRunRequest): Promise<CodexRunResult> {
    const taskId = sanitizeTaskId(request.taskId);
    const outputFile = path.join(this.options.outputDir, `${taskId}.txt`);
    const timeoutMs = Number.isFinite(request.timeoutMs) ? Number(request.timeoutMs) : this.options.timeoutMs;
    const rawTail: string[] = [];

    const args = [
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "-o",
      outputFile,
      request.prompt
    ];

    return new Promise((resolve) => {
      const child = spawn("codex", args, {
        cwd: this.options.rootDir,
        env: process.env
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
        stdoutBuffer = consumeStreamBuffer(rawTail, stdoutBuffer, chunk.toString("utf8"), "stdout", this.options.maxRawLines);
      });

      child.stderr.on("data", (chunk) => {
        stderrBuffer = consumeStreamBuffer(rawTail, stderrBuffer, chunk.toString("utf8"), "stderr", this.options.maxRawLines);
      });

      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
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

        flushRemainingBuffer(rawTail, stdoutBuffer, "stdout", this.options.maxRawLines);
        flushRemainingBuffer(rawTail, stderrBuffer, "stderr", this.options.maxRawLines);

        const error = timedOut
          ? `codex timeout after ${timeoutMs}ms`
          : code === 0
            ? ""
            : `codex exited with code ${code}${signal ? ` (signal ${signal})` : ""}`;

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
}

function consumeStreamBuffer(
  rawTail: string[],
  buffer: string,
  chunk: string,
  channel: "stdout" | "stderr",
  maxRawLines: number
): string {
  const merged = `${buffer}${chunk}`;
  const parts = merged.split(/\r?\n/);
  const remain = parts.pop() ?? "";
  for (const line of parts) {
    pushRawLine(rawTail, line, channel, maxRawLines);
  }
  return remain;
}

function flushRemainingBuffer(rawTail: string[], buffer: string, channel: "stdout" | "stderr", maxRawLines: number): void {
  const line = buffer.trim();
  if (!line) {
    return;
  }
  pushRawLine(rawTail, line, channel, maxRawLines);
}

function pushRawLine(rawTail: string[], line: string, channel: "stdout" | "stderr", maxRawLines: number): void {
  const text = String(line ?? "").trim();
  if (!text) {
    return;
  }
  rawTail.push(`[${channel}] ${text.slice(0, 800)}`);
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
