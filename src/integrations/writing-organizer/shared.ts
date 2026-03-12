import { WritingStateSection } from "./types";

export function normalizeTopicId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function normalizeTopicTitle(raw: string, topicId: string): string {
  const title = String(raw ?? "").trim();
  if (title) {
    return title.slice(0, 120);
  }
  const fallback = topicId.replace(/-/g, " ").trim();
  return (fallback || topicId).slice(0, 120);
}

export function splitFragments(raw: string): string[] {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function normalizeMultilineText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function countNonEmptyLines(content: string): number {
  if (!content) {
    return 0;
  }
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

export function normalizeStateSection(raw: string): WritingStateSection | null {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "summary" || text === "outline" || text === "draft") {
    return text;
  }
  return null;
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseFlags(tokens: string[]): { positionals: string[]; flags: Map<string, string | true> } {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    if (!body) {
      continue;
    }

    const eqIndex = body.indexOf("=");
    if (eqIndex >= 0) {
      const key = body.slice(0, eqIndex).trim().toLowerCase();
      const value = body.slice(eqIndex + 1).trim();
      if (key) {
        flags.set(key, value || true);
      }
      continue;
    }

    const key = body.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const next = tokens[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    i += 1;
  }

  return { positionals, flags };
}

export function readFlagString(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}
