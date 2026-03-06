import { normalizeCategory, normalizeProfileId, normalizeSourceId, normalizeText, parseOptionalBoolean, parseOptionalNumber } from "./shared";
import { ParsedCommand, TopicPushCategory } from "./types";

export function parseCommand(input: string): ParsedCommand {
  const raw = String(input ?? "").trim();
  const fromSlash = /^\/topic\b/i.test(raw);
  const body = fromSlash ? raw.replace(/^\/topic\b/i, "").trim() : raw;

  if (!body) {
    return { kind: "run" };
  }

  const tokens = tokenize(body);
  if (tokens.length === 0) {
    return { kind: "run" };
  }

  const first = tokens[0].toLowerCase();

  if (["help", "h", "?", "帮助"].includes(first)) {
    return { kind: "help" };
  }

  if (["run", "digest", "push", "today", "今日"].includes(first)) {
    const parsed = parseFlags(tokens.slice(1));
    const profileId = readProfileId(parsed.flagValues, parsed.positionals[0]);
    return { kind: "run", ...(profileId ? { profileId } : {}) };
  }

  if (["config", "settings", "配置"].includes(first)) {
    const parsed = parseFlags(tokens.slice(1));
    const profileId = readProfileId(parsed.flagValues, parsed.positionals[0]);
    return { kind: "config_show", ...(profileId ? { profileId } : {}) };
  }

  if (["state", "status", "stats", "状态"].includes(first)) {
    const parsed = parseFlags(tokens.slice(1));
    const second = parsed.positionals[0]?.toLowerCase();
    if (["clear", "reset", "clean", "清空"].includes(second ?? "")) {
      const profileId = readProfileId(parsed.flagValues, parsed.positionals[1]);
      return { kind: "state_clear_sent", ...(profileId ? { profileId } : {}) };
    }
    const profileId = readProfileId(parsed.flagValues, parsed.positionals[0]);
    return { kind: "state_show", ...(profileId ? { profileId } : {}) };
  }

  if (["source", "sources", "rss", "feeds", "源"].includes(first)) {
    return parseSourceCommand(tokens.slice(1));
  }

  if (["profile", "profiles", "entity", "entities", "batch", "分组", "实体", "批次"].includes(first)) {
    return parseProfileCommand(tokens.slice(1));
  }

  if (!fromSlash) {
    return { kind: "run" };
  }

  return { kind: "run" };
}

function parseSourceCommand(tokens: string[]): ParsedCommand {
  if (tokens.length === 0) {
    return { kind: "sources_list" };
  }

  const op = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const parsed = parseFlags(args);
  const profileId = readProfileId(parsed.flagValues);

  if (["list", "ls", "all", "列表"].includes(op)) {
    return { kind: "sources_list", ...(profileId ? { profileId } : {}) };
  }

  if (["get", "show", "详情"].includes(op)) {
    const id = normalizeSourceId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "source-id")
      ?? ""
    );
    if (!id) {
      throw new Error("source get 需要 id，例如: /topic source get openai-blog");
    }
    return { kind: "sources_get", id, ...(profileId ? { profileId } : {}) };
  }

  if (["delete", "remove", "rm", "del", "删除"].includes(op)) {
    const id = normalizeSourceId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "source-id")
      ?? ""
    );
    if (!id) {
      throw new Error("source delete 需要 id，例如: /topic source delete openai-blog");
    }
    return { kind: "sources_delete", id, ...(profileId ? { profileId } : {}) };
  }

  if (["enable", "启用"].includes(op)) {
    const id = normalizeSourceId(parsed.positionals[0] ?? readFlagString(parsed.flagValues, "id") ?? "");
    if (!id) {
      throw new Error("source enable 需要 id，例如: /topic source enable openai-blog");
    }
    return { kind: "sources_toggle", id, enabled: true, ...(profileId ? { profileId } : {}) };
  }

  if (["disable", "停用"].includes(op)) {
    const id = normalizeSourceId(parsed.positionals[0] ?? readFlagString(parsed.flagValues, "id") ?? "");
    if (!id) {
      throw new Error("source disable 需要 id，例如: /topic source disable openai-blog");
    }
    return { kind: "sources_toggle", id, enabled: false, ...(profileId ? { profileId } : {}) };
  }

  if (["add", "create", "新增"].includes(op)) {
    const name = String(parsed.flagValues.get("name") ?? parsed.flagValues.get("title") ?? "").trim();
    const category = normalizeCategory(parsed.flagValues.get("category") ?? parsed.flagValues.get("cat") ?? "");
    const feedUrl = String(parsed.flagValues.get("url") ?? parsed.flagValues.get("feed") ?? parsed.flagValues.get("feed-url") ?? "").trim();
    const id = String(readFlagString(parsed.flagValues, "id") ?? readFlagString(parsed.flagValues, "source-id") ?? "").trim();
    const weight = parseOptionalNumber(parsed.flagValues.get("weight"));
    const enabled = parseOptionalBoolean(parsed.flagValues.get("enabled"));

    if (!name || !category || !feedUrl) {
      throw new Error("source add 参数不足，示例: /topic source add --name \"OpenAI Blog\" --category engineering --url https://openai.com/blog/rss.xml");
    }

    return {
      kind: "sources_add",
      ...(profileId ? { profileId } : {}),
      payload: {
        ...(id ? { id } : {}),
        name,
        category,
        feedUrl,
        ...(weight === undefined ? {} : { weight }),
        ...(enabled === undefined ? {} : { enabled })
      }
    };
  }

  if (["update", "edit", "修改"].includes(op)) {
    const id = normalizeSourceId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "source-id")
      ?? ""
    );
    if (!id) {
      throw new Error("source update 需要 id，例如: /topic source update openai-blog --weight 1.3");
    }

    const patch: {
      name?: string;
      category?: TopicPushCategory;
      feedUrl?: string;
      weight?: number;
      enabled?: boolean;
    } = {};

    const name = String(parsed.flagValues.get("name") ?? parsed.flagValues.get("title") ?? "").trim();
    if (name) {
      patch.name = name;
    }

    const category = normalizeCategory(parsed.flagValues.get("category") ?? parsed.flagValues.get("cat") ?? "");
    if (category) {
      patch.category = category;
    }

    const url = String(parsed.flagValues.get("url") ?? parsed.flagValues.get("feed") ?? parsed.flagValues.get("feed-url") ?? "").trim();
    if (url) {
      patch.feedUrl = url;
    }

    const weight = parseOptionalNumber(parsed.flagValues.get("weight"));
    if (weight !== undefined) {
      patch.weight = weight;
    }

    const enabled = parseOptionalBoolean(parsed.flagValues.get("enabled"));
    if (enabled !== undefined) {
      patch.enabled = enabled;
    }

    if (Object.keys(patch).length === 0) {
      throw new Error("source update 需要至少一个变更字段（name/category/url/weight/enabled）");
    }

    return {
      kind: "sources_update",
      id,
      ...(profileId ? { profileId } : {}),
      patch
    };
  }

  throw new Error(`unknown source command: ${op}`);
}

function parseProfileCommand(tokens: string[]): ParsedCommand {
  if (tokens.length === 0) {
    return { kind: "profiles_list" };
  }

  const op = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const parsed = parseFlags(args);

  if (["list", "ls", "all", "列表"].includes(op)) {
    return { kind: "profiles_list" };
  }

  if (["get", "show", "详情"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    if (!id) {
      throw new Error("profile get 需要 id，例如: /topic profile get ai-engineering");
    }
    return { kind: "profiles_get", id };
  }

  if (["use", "switch", "activate", "切换"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    if (!id) {
      throw new Error("profile use 需要 id，例如: /topic profile use ai-engineering");
    }
    return { kind: "profiles_use", id };
  }

  if (["delete", "remove", "rm", "del", "删除"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    if (!id) {
      throw new Error("profile delete 需要 id，例如: /topic profile delete ai-engineering");
    }
    return { kind: "profiles_delete", id };
  }

  if (["add", "create", "新增"].includes(op)) {
    const name = normalizeText(readFlagString(parsed.flagValues, "name"));
    const id = normalizeText(readFlagString(parsed.flagValues, "id") ?? readFlagString(parsed.flagValues, "profile-id"));
    const cloneFrom = normalizeText(
      readFlagString(parsed.flagValues, "clone-from")
      ?? readFlagString(parsed.flagValues, "clone")
      ?? readFlagString(parsed.flagValues, "from")
    );
    if (!name) {
      throw new Error("profile add 参数不足，示例: /topic profile add --name \"AI 日报\" [--id ai-engineering]");
    }
    return {
      kind: "profiles_add",
      payload: {
        name,
        ...(id ? { id } : {}),
        ...(cloneFrom ? { cloneFrom } : {})
      }
    };
  }

  if (["update", "edit", "修改"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    const name = normalizeText(readFlagString(parsed.flagValues, "name"));
    if (!id) {
      throw new Error("profile update 需要 id，例如: /topic profile update ai-engineering --name \"AI Digest\"");
    }
    if (!name) {
      throw new Error("profile update 目前仅支持 --name");
    }
    return {
      kind: "profiles_update",
      id,
      patch: {
        name
      }
    };
  }

  throw new Error(`unknown profile command: ${op}`);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
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

function parseFlags(tokens: string[]): { positionals: string[]; flagValues: Map<string, string | true> } {
  const positionals: string[] = [];
  const flagValues = new Map<string, string | true>();

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
        flagValues.set(key, value || true);
      }
      continue;
    }

    const key = body.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const next = tokens[i + 1];
    if (!next || next.startsWith("--")) {
      flagValues.set(key, true);
      continue;
    }

    flagValues.set(key, next);
    i += 1;
  }

  return { positionals, flagValues };
}

function readFlagString(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function readProfileId(flags: Map<string, string | true>, positional?: string): string | undefined {
  const raw = readFlagString(flags, "profile")
    ?? readFlagString(flags, "profile-id")
    ?? positional
    ?? "";
  const normalized = normalizeProfileId(raw);
  return normalized || undefined;
}
