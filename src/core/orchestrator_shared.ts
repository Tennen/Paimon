import { Envelope, Image, Response } from "../types";
import { RawMemoryMeta } from "../memory/rawMemoryStore";

export function inferNonTextMemoryMarker(kind: string): string {
  if (kind === "image") {
    return "[image]";
  }
  if (kind === "audio" || kind === "voice") {
    return "[audio]";
  }
  return "";
}

export function formatMemoryEntry(userText: string, response: Response): string {
  const now = new Date().toISOString();
  const assistantText = response.text ?? "";
  return `- ${now}\\n  - user: ${userText}\\n  - assistant: ${assistantText}`;
}

export function normalizeRawMemoryMeta(meta: unknown): RawMemoryMeta {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  return { ...(meta as Record<string, unknown>) };
}

export function buildToolResultResponse(result: { ok: boolean; output?: unknown; error?: string }): Response {
  if (!result.ok) {
    const errorText = result.error ? `Tool error: ${result.error}` : "Tool failed";
    return { text: errorText };
  }
  const output = result.output as Record<string, unknown> | string | undefined;
  if (typeof output === "string") {
    return { text: output.trim() || "OK" };
  }
  if (output && typeof output === "object") {
    const text = output.text;
    const hasTextField = Object.prototype.hasOwnProperty.call(output, "text");
    if (hasTextField && typeof text === "string") {
      return { text: text.trim() };
    }

    const hasImageField = Object.prototype.hasOwnProperty.call(output, "image")
      || Object.prototype.hasOwnProperty.call(output, "images");
    if (hasImageField) {
      return { text: "" };
    }
  }
  const sanitized = sanitizeToolResult(output);
  if (sanitized !== undefined) {
    return { text: JSON.stringify(sanitized, null, 2) };
  }
  return { text: "OK" };
}

export function normalizeImages(images: Image[] | undefined): Image[] {
  if (!Array.isArray(images)) return [];
  return images.filter((image) => Boolean(image && typeof image.data === "string" && image.data.length > 0));
}

export function isGenericResponseText(text: string | undefined): boolean {
  const normalized = String(text ?? "").trim().toLowerCase();
  return normalized.length === 0 || normalized === "ok" || normalized === "tool failed";
}

export function createAsyncTaskId(command: string): string {
  const normalized = String(command ?? "").trim().replace(/[^a-z0-9]+/gi, "").toLowerCase() || "task";
  return `${normalized}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAsyncTaskEnvelope(envelope: Envelope, taskId: string): Envelope {
  return {
    ...envelope,
    requestId: `${envelope.requestId}:async:${taskId}`
  };
}

export async function waitForPromiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ completed: true; value: T } | { completed: false }> {
  if (timeoutMs <= 0) {
    return { completed: false };
  }

  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<{ completed: false }>((resolve) => {
    timer = setTimeout(() => resolve({ completed: false }), timeoutMs);
  });

  const settled = await Promise.race([
    promise.then((value) => ({ completed: true as const, value })),
    timeout
  ]);

  if (timer) {
    clearTimeout(timer);
  }

  return settled;
}

export function runDeferred<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      void task().then(resolve).catch(reject);
    });
  });
}

function sanitizeToolResult(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeToolResult(item));
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.data === "string" && (typeof obj.contentType === "string" || typeof obj.filename === "string")) {
    return {
      ...(typeof obj.contentType === "string" ? { contentType: obj.contentType } : {}),
      ...(typeof obj.filename === "string" ? { filename: obj.filename } : {}),
      size: obj.data.length
    };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "image" && value && typeof value === "object") {
      const image = value as Record<string, unknown>;
      out[key] = {
        ...(typeof image.contentType === "string" ? { contentType: image.contentType } : {}),
        ...(typeof image.filename === "string" ? { filename: image.filename } : {}),
        ...(typeof image.size === "number" ? { size: image.size } : {})
      };
      continue;
    }
    if (key === "images" && Array.isArray(value)) {
      out[key] = value.map((item) => sanitizeToolResult(item));
      continue;
    }
    out[key] = sanitizeToolResult(value);
  }
  return out;
}
