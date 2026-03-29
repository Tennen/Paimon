import fs from "fs";
import { spawn } from "child_process";
import { isRecord, summarizeCodexArgs, truncateText } from "./shared";
import type { CodexExecutionResult } from "./types";

export async function runCodexCommand(
  args: string[],
  options: { cwd: string; timeoutMs: number; outputFile: string }
): Promise<CodexExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timeoutMs = Math.max(1000, options.timeoutMs);
    const taskRef = options.outputFile.split("/").pop() || options.outputFile;

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
    const parsed = parseLineAsRecord(lines[i]);
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
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCandidateText(record: Record<string, unknown>): string {
  for (const candidate of [record.output, record.response, record.text, record.content, record.message, record.final]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const item = isRecord(record.item) ? record.item : null;
  return item ? readCandidateText(item) : "";
}
