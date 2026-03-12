import { ParsedCommand } from "./types";
import {
  normalizeStateSection,
  normalizeTopicId,
  normalizeMultilineText,
  parseFlags,
  readFlagString,
  tokenize
} from "./shared";

export function parseCommand(input: string): ParsedCommand {
  const raw = String(input ?? "").trim();
  const fromSlash = /^\/writing\b/i.test(raw);
  const fromPrefix = /^writing\b/i.test(raw);
  const body = fromSlash
    ? raw.replace(/^\/writing\b/i, "").trim()
    : fromPrefix
      ? raw.replace(/^writing\b/i, "").trim()
      : raw;

  if (!body) {
    return { kind: "help" };
  }

  const tokens = tokenize(body);
  if (tokens.length === 0) {
    return { kind: "help" };
  }

  const op = tokens[0].toLowerCase();
  const parsed = parseFlags(tokens.slice(1));

  if (["help", "h", "?", "帮助"].includes(op)) {
    return { kind: "help" };
  }

  if (["topics", "list", "ls", "列表"].includes(op)) {
    return { kind: "topics" };
  }

  if (["show", "get", "detail", "详情"].includes(op)) {
    const topicId = normalizeTopicId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flags, "topic")
      ?? readFlagString(parsed.flags, "topic-id")
      ?? ""
    );
    if (!topicId) {
      throw new Error("show 需要 topic-id，例如: /writing show relationship-boundaries");
    }
    return { kind: "show", topicId };
  }

  if (["append", "add", "记录", "追加"].includes(op)) {
    const topicId = normalizeTopicId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flags, "topic")
      ?? readFlagString(parsed.flags, "topic-id")
      ?? ""
    );
    if (!topicId) {
      throw new Error("append 需要 topic-id，例如: /writing append relationship-boundaries \"一段新内容\"");
    }

    const title = normalizeMultilineText(
      readFlagString(parsed.flags, "title")
      ?? readFlagString(parsed.flags, "name")
      ?? ""
    );

    const positionalContent = parsed.positionals.slice(1).join(" ");
    const content = normalizeMultilineText(
      readFlagString(parsed.flags, "content")
      ?? positionalContent
    );

    if (!content) {
      throw new Error("append 需要 content，例如: /writing append relationship-boundaries \"一段新内容\"");
    }

    return {
      kind: "append",
      topicId,
      content,
      ...(title ? { title } : {})
    };
  }

  if (["summarize", "summary", "整理", "汇总"].includes(op)) {
    const topicId = normalizeTopicId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flags, "topic")
      ?? readFlagString(parsed.flags, "topic-id")
      ?? ""
    );
    if (!topicId) {
      throw new Error("summarize 需要 topic-id，例如: /writing summarize relationship-boundaries");
    }
    return { kind: "summarize", topicId };
  }

  if (["restore", "rollback", "回滚", "恢复"].includes(op)) {
    const topicId = normalizeTopicId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flags, "topic")
      ?? readFlagString(parsed.flags, "topic-id")
      ?? ""
    );
    if (!topicId) {
      throw new Error("restore 需要 topic-id，例如: /writing restore relationship-boundaries");
    }
    return { kind: "restore", topicId };
  }

  if (["set", "edit", "manual", "手动"].includes(op)) {
    const topicId = normalizeTopicId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flags, "topic")
      ?? readFlagString(parsed.flags, "topic-id")
      ?? ""
    );
    if (!topicId) {
      throw new Error("set 需要 topic-id，例如: /writing set relationship-boundaries summary \"新的摘要\"");
    }

    const section = normalizeStateSection(
      parsed.positionals[1]
      ?? readFlagString(parsed.flags, "section")
      ?? ""
    );
    if (!section) {
      throw new Error("set 需要 section(summary|outline|draft)，例如: /writing set relationship-boundaries summary \"新的摘要\"");
    }

    const positionalContent = parsed.positionals.slice(2).join(" ");
    const content = normalizeMultilineText(
      readFlagString(parsed.flags, "content")
      ?? positionalContent
    );
    if (!content) {
      throw new Error("set 需要 content，例如: /writing set relationship-boundaries draft \"新的草稿\"");
    }

    return {
      kind: "set_state",
      topicId,
      section,
      content
    };
  }

  if (!fromSlash && !fromPrefix) {
    return { kind: "help" };
  }

  return { kind: "help" };
}
