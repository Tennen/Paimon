import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import {
  directCommands,
  execute as executeWritingOrganizer
} from "../integrations/writing-organizer/service";
import { ToolResult } from "../types";

export function registerTool(registry: ToolRegistry, _deps: ToolDependencies): void {
  registry.register(
    {
      name: "skill.writing-organizer",
      execute: (op, args) => executeInputTool(op, args, async (input) => executeWritingOrganizer(input))
    },
    {
      name: "skill.writing-organizer",
      description: "Incremental writing organizer with rolling raw storage, summarize and restore.",
      operations: [
        {
          op: "execute",
          description: "Execute writing-organizer request.",
          params: {
            input: "string"
          }
        }
      ]
    }
  );

  registerDirectCommands(registry, directCommands, {
    tool: "skill.writing-organizer",
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
