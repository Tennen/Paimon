import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { ensureDir, resolveDataPath } from "../../storage/persistence";
import {
  buildResult,
  consumeStreamBuffer,
  detectApprovalPrompt,
  flushRemainingBuffer
} from "./adapterStream";
import {
  emitCodexEvent,
  formatTomlString,
  normalizeApprovalPolicy,
  normalizeReasoningEffort,
  nowIso,
  resolveCodexModel,
  resolveCodexReasoningEffort,
  sanitizeTaskId
} from "./adapterShared";
export type {
  CodexPendingApproval,
  CodexRunEvent,
  CodexRunRequest,
  CodexRunResult
} from "./adapterTypes";
import {
  ActiveCodexRun,
  CodexAdapterOptions,
  CodexPendingApproval,
  CodexRunRequest,
  CodexRunResult
} from "./adapterTypes";

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
