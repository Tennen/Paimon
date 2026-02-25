import { ToolResult } from "../types";
import { SkillManager } from "../skills/skillManager";
import { getSkillHandlerToolName } from "../skills/toolNaming";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";

type EvolutionServiceBridge = {
  getTickMs: () => number;
  getSnapshot: () => unknown;
  enqueueGoal: (input: { goal: string; commitMessage?: string }) => Promise<unknown>;
  triggerNow: () => Promise<void>;
  getCodexConfig: () => { codexModel: string; codexReasoningEffort: string; envPath: string };
  updateCodexConfig: (input: { model?: string; reasoningEffort?: string }) => { codexModel: string; codexReasoningEffort: string; envPath: string };
};

export class SkillTool {
  private readonly manager: SkillManager;
  private readonly evolutionService?: EvolutionServiceBridge;

  constructor(manager: SkillManager, evolutionService?: EvolutionServiceBridge) {
    this.manager = manager;
    this.evolutionService = evolutionService;
  }

  async execute(op: string, args: Record<string, unknown>, context: Record<string, unknown>): Promise<ToolResult> {
    if (op !== "execute") {
      return { ok: false, error: `Unsupported operation: ${op}` };
    }

    const name = args.name as string | undefined;
    const input = (args.input as string | undefined) ?? "";

    if (!name) {
      return { ok: false, error: "Missing skill name" };
    }

    try {
      const result = await this.manager.invoke(name, input, this.buildInvokeContext(context));
      return { ok: true, output: result };
    } catch (error) {
      return { ok: false, error: `Failed to execute skill '${name}': ${(error as Error).message}` };
    }
  }

  async executeBoundSkill(
    skillName: string,
    op: string,
    args: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<ToolResult> {
    if (op !== "execute") {
      return { ok: false, error: `Unsupported operation: ${op}` };
    }

    const input = (args.input as string | undefined) ?? "";
    try {
      const result = await this.manager.invoke(skillName, input, this.buildInvokeContext(context));
      return { ok: true, output: result };
    } catch (error) {
      return { ok: false, error: `Failed to execute skill '${skillName}': ${(error as Error).message}` };
    }
  }

  private buildInvokeContext(context: Record<string, unknown>): Record<string, unknown> {
    if (!this.evolutionService) {
      return context;
    }
    return {
      ...context,
      evolution: {
        getTickMs: () => this.evolutionService?.getTickMs() ?? 0,
        getSnapshot: () => this.evolutionService?.getSnapshot(),
        enqueueGoal: (input: { goal: string; commitMessage?: string }) => this.evolutionService?.enqueueGoal(input),
        triggerNow: () => this.evolutionService?.triggerNow(),
        getCodexConfig: () => this.evolutionService?.getCodexConfig(),
        updateCodexConfig: (input: { model?: string; reasoningEffort?: string }) => this.evolutionService?.updateCodexConfig(input)
      }
    };
  }
}

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const manager = deps.skillManager as SkillManager;
  const tool = new SkillTool(manager, deps.evolutionService as EvolutionServiceBridge | undefined);

  registry.register(
    {
      name: "skill",
      execute: (op, args, context) => tool.execute(op, args, context),
    },
    {
      name: "skill",
      operations: [
        {
          op: "execute",
          params: {
            name: "string",
            input: "string"
          }
        }
      ]
    }
  );

  for (const skill of manager.list()) {
    if (!skill.hasHandler) {
      continue;
    }

    const toolName = getSkillHandlerToolName(skill.name);
    const keywords = skill.metadata?.keywords ?? skill.keywords;

    registry.register(
      {
        name: toolName,
        execute: (op, args, context) => tool.executeBoundSkill(skill.name, op, args, context),
      },
      {
        name: toolName,
        operations: [
          {
            op: "execute",
            params: {
              input: "string"
            }
          }
        ],
        ...(keywords ? { keywords } : {})
      }
    );

    const directCommands = skill.directCommands ?? skill.metadata?.directCommands;
    if (Array.isArray(directCommands)) {
      for (const command of directCommands) {
        registry.registerDirectToolCall({
          command,
          tool: toolName,
          op: "execute",
          argName: "input",
          argMode: "full_input",
          preferToolResult: skill.preferToolResult ?? true,
          async: skill.directAsync ?? false,
          acceptedText: skill.directAcceptedText,
          acceptedDelayMs: skill.directAcceptedDelayMs
        });
      }
    }
  }
}
