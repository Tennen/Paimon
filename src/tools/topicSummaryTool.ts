import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import {
  directCommands,
  execute as executeTopicSummary
} from "../integrations/topic-summary/service";
import { ToolResult } from "../types";

export function registerTool(registry: ToolRegistry, _deps: ToolDependencies): void {
  registry.register(
    {
      name: "skill.topic-summary",
      execute: (op, args, context) =>
        executeInputTool(
          op,
          args,
          async (input) => {
            const explicitLanguage = readExplicitLanguageFlag(input);
            return executeTopicSummary(input, {
              explicitLanguage: explicitLanguage ?? undefined,
              inferredLanguage: explicitLanguage ? undefined : detectUserLanguage(input, context)
            });
          }
        )
    },
    {
      name: "skill.topic-summary",
      description: "Generate topic-specific daily digest from RSS feeds with profile isolation and source CRUD.",
      operations: [
        {
          op: "execute",
          description: "Execute topic-summary command.",
          params: {
            input: "string"
          }
        }
      ]
    }
  );

  registerDirectCommands(registry, directCommands, {
    tool: "skill.topic-summary",
    op: "execute",
    argName: "input",
    argMode: "full_input",
    preferToolResult: true
  });
}

async function executeInputTool(
  op: string,
  args: Record<string, unknown>,
  runner: (input: string) => Promise<unknown>
): Promise<ToolResult> {
  if (op !== "execute") {
    return { ok: false, error: `Unsupported action: ${op}` };
  }
  const input = String(args.input ?? "").trim();
  if (!input) {
    return { ok: false, error: "Missing input" };
  }

  try {
    const output = await runner(input);
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function registerDirectCommands(
  registry: ToolRegistry,
  commands: string[],
  route: {
    tool: string;
    op: string;
    argName: string;
    argMode: "full_input" | "rest";
    preferToolResult?: boolean;
    async?: boolean;
    acceptedText?: string;
    acceptedDelayMs?: number;
  }
): void {
  for (const command of commands) {
    registry.registerDirectToolCall({
      command,
      tool: route.tool,
      op: route.op,
      argName: route.argName,
      argMode: route.argMode,
      preferToolResult: route.preferToolResult ?? true,
      async: route.async ?? false,
      acceptedText: route.acceptedText,
      acceptedDelayMs: route.acceptedDelayMs
    });
  }
}

function detectUserLanguage(input: string, context: Record<string, unknown>): string {
  const memory = typeof context.memory === "string" ? context.memory : "";
  const sample = `${input}\n${memory.slice(-4000)}`;
  const zhCount = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const enCount = (sample.match(/[a-zA-Z]/g) ?? []).length;

  if (zhCount > 0 && zhCount * 2 >= enCount) {
    return "zh-CN";
  }
  if (enCount > 0) {
    return "en";
  }
  return "zh-CN";
}

function readExplicitLanguageFlag(input: string): string | null {
  const text = String(input ?? "");
  const match = text.match(/--(?:lang|language)\s+([a-zA-Z-]+)/i)
    ?? text.match(/--(?:lang|language)=([a-zA-Z-]+)/i);
  if (!match?.[1]) {
    return null;
  }
  const raw = match[1].trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("zh")) {
    return "zh-CN";
  }
  if (raw.startsWith("en")) {
    return "en";
  }
  return raw;
}
