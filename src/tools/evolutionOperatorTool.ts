// @ts-nocheck
import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import { execute } from "./evolutionOperatorTool/executor";
import { buildEvolutionContext, executeInputTool } from "./evolutionOperatorTool/context";
import { EvolutionServiceBridge } from "./evolutionOperatorTool/types";

export const evolutionDirectCommands = ["/evolve", "/coding"];
export const codexDirectCommands = ["/codex"];

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const evolutionService = deps.evolutionService as EvolutionServiceBridge | undefined;

  registry.register(
    {
      name: "skill.evolution-operator",
      execute: (op, args, context) =>
        executeInputTool(op, args, async (input) => execute(input, buildEvolutionContext(context, evolutionService)))
    },
    {
      name: "skill.evolution-operator",
      description: "Control built-in evolution runtime via chat commands.",
      operations: [
        {
          op: "execute",
          description: "Execute evolution operator command.",
          params: {
            input: "string"
          }
        }
      ]
    }
  );

  registerDirectCommands(registry, evolutionDirectCommands, {
    tool: "skill.evolution-operator",
    op: "execute",
    argName: "input",
    argMode: "full_input",
    preferToolResult: true,
    async: true,
    acceptedText: "收到，Evolution 任务已受理，后台处理中；完成后会回传结果。",
    acceptedDelayMs: 1200
  });

  registerDirectCommands(registry, codexDirectCommands, {
    tool: "skill.evolution-operator",
    op: "execute",
    argName: "input",
    argMode: "full_input",
    preferToolResult: true
  });
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

export { execute } from "./evolutionOperatorTool/executor";
