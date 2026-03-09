import {
  RE_AGENT_COMMAND_PREFIX,
  RE_AGENT_HELP_TOKENS,
  RE_AGENT_RESET_TOKENS,
  ReAgentCommand,
  ReAgentCommandKind
} from "./types";

const RE_AGENT_PREFIX_PATTERN = /^\/re(?:\s+|$)/i;
const HELP_TOKEN_SET = new Set<string>(RE_AGENT_HELP_TOKENS);
const RESET_TOKEN_SET = new Set<string>(RE_AGENT_RESET_TOKENS);

export function parseReAgentCommand(input: string | null | undefined): ReAgentCommand {
  const rawInput = String(input ?? "").trim();

  if (!rawInput) {
    return {
      kind: "help",
      rawInput,
      prefixedInput: RE_AGENT_COMMAND_PREFIX,
      content: ""
    };
  }

  const hasPrefix = RE_AGENT_PREFIX_PATTERN.test(rawInput);
  const content = hasPrefix
    ? rawInput.replace(RE_AGENT_PREFIX_PATTERN, "").trim()
    : rawInput;

  const kind = detectCommandKind(content);

  return {
    kind,
    rawInput,
    prefixedInput: hasPrefix ? rawInput : withReAgentPrefix(content),
    content
  };
}

export function withReAgentPrefix(input: string | null | undefined): string {
  const content = String(input ?? "").trim();
  if (!content) {
    return RE_AGENT_COMMAND_PREFIX;
  }
  return `${RE_AGENT_COMMAND_PREFIX} ${content}`;
}

export function isReAgentCommandInput(input: string | null | undefined): boolean {
  const rawInput = String(input ?? "").trim();
  return RE_AGENT_PREFIX_PATTERN.test(rawInput);
}

function detectCommandKind(content: string): ReAgentCommandKind {
  const normalized = content.toLowerCase();

  if (!normalized || HELP_TOKEN_SET.has(normalized)) {
    return "help";
  }

  if (RESET_TOKEN_SET.has(normalized)) {
    return "reset";
  }

  return "ask";
}
