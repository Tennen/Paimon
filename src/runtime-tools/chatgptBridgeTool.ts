import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import {
  directAcceptedDelayMs,
  directAcceptedText,
  directAsync,
  directCommands,
  execute as executeChatgptBridge
} from "../integrations/chatgpt-bridge/service";
import { ToolResult } from "../types";

export function registerTool(registry: ToolRegistry, _deps: ToolDependencies): void {
  registry.register(
    {
      name: "skill.chatgpt-bridge",
      execute: (op, args) => executeInputTool(op, args, async (input) => executeChatgptBridge(input))
    },
    {
      name: "skill.chatgpt-bridge",
      description: "Route prompt to ChatGPT Web bridge runtime.",
      operations: [
        {
          op: "execute",
          description: "Execute chatgpt bridge request.",
          params: {
            input: "string"
          }
        }
      ]
    }
  );

  registerDirectCommands(registry, directCommands, {
    tool: "skill.chatgpt-bridge",
    op: "execute",
    argName: "input",
    argMode: "full_input",
    preferToolResult: true,
    async: directAsync,
    acceptedText: directAcceptedText,
    acceptedDelayMs: directAcceptedDelayMs
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
