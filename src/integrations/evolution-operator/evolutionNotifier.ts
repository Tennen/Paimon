import { WeComSender } from "../wecom/sender";

const DEFAULT_GIT_LOG_MAX_LINES = 6;
const DEFAULT_GIT_LOG_LINE_MAX_LENGTH = 88;
const UTF8_ENCODER = new TextEncoder();

export type EvolutionNotifyEnvSource = "EVOLUTION_NOTIFY_TO" | "WECOM_NOTIFY_TO" | "none";

export type EvolutionNotifyRecipients = {
  source: EvolutionNotifyEnvSource;
  raw: string;
  users: string[];
  toUser: string;
};

export type EvolutionNotifyPreview = {
  recipients: EvolutionNotifyRecipients;
  message: string;
  gitLogSummary: string;
};

export type EvolutionNotifierSendResult = {
  sent: boolean;
  toUser: string;
  chunks: number;
};

export type FormatGitLogSummaryOptions = {
  maxLines?: number;
  maxLineLength?: number;
};

export type EvolutionNotifierOptions = {
  env?: NodeJS.ProcessEnv;
  sender?: Pick<WeComSender, "sendText">;
};

export function resolveEvolutionNotifyRecipients(env: NodeJS.ProcessEnv = process.env): EvolutionNotifyRecipients {
  const primary = normalizeNotifyField(env.EVOLUTION_NOTIFY_TO, "EVOLUTION_NOTIFY_TO");
  if (primary.users.length > 0) {
    return primary;
  }

  const fallback = normalizeNotifyField(env.WECOM_NOTIFY_TO, "WECOM_NOTIFY_TO");
  if (fallback.users.length > 0) {
    return fallback;
  }

  return {
    source: "none",
    raw: "",
    users: [],
    toUser: ""
  };
}

export class EvolutionNotifier {
  private readonly env: NodeJS.ProcessEnv;
  private readonly sender: Pick<WeComSender, "sendText">;

  constructor(options?: EvolutionNotifierOptions) {
    this.env = options?.env ?? process.env;
    this.sender = options?.sender ?? new WeComSender();
  }

  getRecipients(): EvolutionNotifyRecipients {
    return resolveEvolutionNotifyRecipients(this.env);
  }

  async sendText(content: string): Promise<EvolutionNotifierSendResult> {
    const recipients = this.getRecipients();
    if (!recipients.toUser) {
      return {
        sent: false,
        toUser: "",
        chunks: 0
      };
    }

    const chunks = splitByUtf8Bytes(cleanNotifyText(content), 1700);
    if (chunks.length === 0) {
      return {
        sent: false,
        toUser: recipients.toUser,
        chunks: 0
      };
    }

    for (const chunk of chunks) {
      await this.sender.sendText(recipients.toUser, chunk);
    }

    return {
      sent: true,
      toUser: recipients.toUser,
      chunks: chunks.length
    };
  }
}

export function cleanNotifyText(input: string): string {
  const noAnsi = String(input ?? "").replace(/\u001b\[[0-9;]*m/g, " ");
  const noControl = noAnsi.replace(/[\u0000-\u001f\u007f]/g, " ");
  const noJsonMarks = noControl.replace(/[{}\[\]`\\<>"']/g, " ");
  const noOddSymbols = noJsonMarks.replace(/[^\p{L}\p{N}\s:.,()\-_/]/gu, " ");
  return noOddSymbols
    .replace(/\s+/g, " ")
    .trim();
}

export function formatGitLogSummary(rawGitLog: string, options?: FormatGitLogSummaryOptions): string {
  const maxLines = normalizeInt(options?.maxLines, DEFAULT_GIT_LOG_MAX_LINES, 1, 20);
  const maxLineLength = normalizeInt(options?.maxLineLength, DEFAULT_GIT_LOG_LINE_MAX_LENGTH, 32, 200);

  const entries = String(rawGitLog ?? "")
    .split(/\r?\n/)
    .map((line) => parseGitLogLine(line, maxLineLength))
    .filter((line): line is string => Boolean(line));

  if (entries.length === 0) {
    return "";
  }

  const deduped = dedupe(entries).slice(0, maxLines);
  if (deduped.length === 0) {
    return "";
  }

  return deduped.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
}

export function previewEvolutionNotificationFormat(input?: {
  evolutionNotifyTo?: string;
  wecomNotifyTo?: string;
  content?: string;
  rawGitLog?: string;
}): EvolutionNotifyPreview {
  const env: NodeJS.ProcessEnv = {
    EVOLUTION_NOTIFY_TO: input?.evolutionNotifyTo,
    WECOM_NOTIFY_TO: input?.wecomNotifyTo
  };

  const recipients = resolveEvolutionNotifyRecipients(env);
  const message = cleanNotifyText(input?.content ?? "");
  const gitLogSummary = formatGitLogSummary(input?.rawGitLog ?? "");

  return {
    recipients,
    message,
    gitLogSummary
  };
}

function normalizeNotifyField(value: string | undefined, source: Exclude<EvolutionNotifyEnvSource, "none">): EvolutionNotifyRecipients {
  const raw = String(value ?? "").trim();
  const users = raw
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const dedupedUsers = dedupe(users);
  if (dedupedUsers.length === 0) {
    return {
      source: "none",
      raw,
      users: [],
      toUser: ""
    };
  }

  return {
    source,
    raw,
    users: dedupedUsers,
    toUser: dedupedUsers.join("|")
  };
}

function parseGitLogLine(line: string, maxLineLength: number): string {
  const raw = String(line ?? "").trim();
  if (!raw) {
    return "";
  }

  const pipeParts = raw.split("|").map((item) => item.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    const hash = normalizeHash(pipeParts[0]);
    const subject = clip(cleanNotifyText(pipeParts.slice(2).join(" ") || pipeParts[1]), maxLineLength);
    return hash && subject ? `${hash} ${subject}` : subject;
  }

  const oneLineMatched = raw.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
  if (oneLineMatched) {
    const hash = normalizeHash(oneLineMatched[1]);
    const subject = clip(cleanNotifyText(oneLineMatched[2]), maxLineLength);
    return hash && subject ? `${hash} ${subject}` : subject;
  }

  if (/^(commit|author:|date:)/i.test(raw)) {
    return "";
  }

  return clip(cleanNotifyText(raw), maxLineLength);
}

function normalizeHash(value: string): string {
  const matched = String(value ?? "").match(/[0-9a-f]{7,40}/i);
  return matched ? matched[0].slice(0, 12).toLowerCase() : "";
}

function splitByUtf8Bytes(text: string, maxBytes: number): string[] {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (utf8Bytes(candidate) <= maxBytes) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (utf8Bytes(line) <= maxBytes) {
      current = line;
      continue;
    }

    chunks.push(clipByBytes(line, maxBytes));
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function clipByBytes(text: string, maxBytes: number): string {
  let output = "";
  for (const ch of text) {
    const next = output + ch;
    if (utf8Bytes(next) > maxBytes) {
      break;
    }
    output = next;
  }
  return output;
}

function utf8Bytes(text: string): number {
  return UTF8_ENCODER.encode(text).length;
}

function clip(text: string, maxLength: number): string {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = String(item ?? "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

function normalizeInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value as number)));
}
