import fs from "fs";
import { CodexRunRequest, CodexRunResult } from "./adapterTypes";

export function consumeStreamBuffer(
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

export function flushRemainingBuffer(
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

export function buildResult(input: {
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

export function detectApprovalPrompt(line: string): string | null {
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
