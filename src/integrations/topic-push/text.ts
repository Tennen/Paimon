import { asRecord, clampText, normalizeText } from "./shared";
import { TopicDigestItemType } from "./types";

export function toText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = toText(item);
      if (text) {
        return text;
      }
    }
    return "";
  }

  const source = asRecord(value);
  if (!source) {
    return "";
  }

  const candidates: unknown[] = [
    source["#text"],
    source["$text"],
    source["__cdata"],
    source["@_value"],
    source.value,
    source.href,
    source["@_href"]
  ];

  for (const item of candidates) {
    const text = toText(item);
    if (text) {
      return text;
    }
  }

  return "";
}

export function stripFeedMetadataNoise(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .replace(/comments?\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/comments?\s*url\s*:\s*(?=(?:points?|#\s*comments?|comments?)\s*:|$)/gi, " ")
    .replace(/#\s*comments?\s*:\s*\d+\b/gi, " ")
    .replace(/\bcomments?\s*:\s*\d+\b/gi, " ")
    .replace(/\bpoints?\s*:\s*\d+\b/gi, " ");
}

export function normalizeSummary(text: string): string {
  if (!text) {
    return "";
  }

  const withoutTags = stripFeedMetadataNoise(text)
    .replace(/<!\[CDATA\[|\]\]>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/article\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/source\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clampText(withoutTags, 280);
}

export function normalizeTitle(text: string): string {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .trim();
}

export function detectLang(text: string): "zh" | "en" | "unknown" {
  const value = normalizeText(text);
  if (!value) {
    return "unknown";
  }
  if (/[\u4e00-\u9fff]/.test(value)) {
    return "zh";
  }
  if (/[a-zA-Z]/.test(value)) {
    return "en";
  }
  return "unknown";
}

export function firstSentence(text: string): string {
  const plain = normalizeSummary(text);
  if (!plain) {
    return "";
  }

  const match = plain.match(/^(.{20,180}?[。！？!?\.])/);
  const sentence = match?.[1] ?? plain;
  return clampText(sentence, 120);
}

export function buildDigestSummary(summary: string): string {
  const summarySentence = firstSentence(summary);
  if (summarySentence) {
    return summarySentence;
  }
  return "";
}

export function sanitizePlanningText(value: unknown, maxLength: number): string {
  const text = stripFeedMetadataNoise(normalizeText(value))
    .replace(/article\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/source\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\[(?:source|ecosystem|engineering|news)\s*:?\]/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-*]\s*/g, "")
    .trim();
  return clampText(text, maxLength);
}

export function sanitizeDigestTitle(value: unknown, maxLength: number): string {
  const text = sanitizePlanningText(value, maxLength)
    .replace(/^show\s*hn\s*:\s*/i, "")
    .replace(/^source\s*:\s*/i, "")
    .replace(/^\[(?:source|ecosystem|engineering|news)\s*:?\]\s*/i, "")
    .trim();
  return clampText(text, maxLength);
}

export function sanitizeDigestSummary(value: unknown, maxLength: number): string {
  const text = sanitizePlanningText(value, maxLength)
    .replace(/^(?:why|summary|brief)\s*:\s*/i, "")
    .trim();
  return clampText(text, maxLength);
}

export function titleSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeForSimilarity(left);
  const rightTokens = tokenizeForSimilarity(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    const normalizedLeft = normalizeTitle(left);
    const normalizedRight = normalizeTitle(right);
    return normalizedLeft && normalizedLeft === normalizedRight ? 1 : 0;
  }

  let intersect = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersect += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersect;
  if (union <= 0) {
    return 0;
  }
  return intersect / union;
}

function tokenizeForSimilarity(title: string): Set<string> {
  const normalized = normalizeTitle(title).toLowerCase();
  if (!normalized) {
    return new Set<string>();
  }

  const parts = normalized
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  return new Set(parts);
}

export function normalizeDigestType(raw: unknown): TopicDigestItemType | null {
  const value = normalizeText(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (!value) {
    return null;
  }
  if (["news", "brief", "brief_news", "quick_news", "one_line_news"].includes(value)) {
    return "news";
  }
  if (["deep_read", "deepread", "deep", "recommended", "recommendation", "long_read", "analysis"].includes(value)) {
    return "deep_read";
  }
  return null;
}
