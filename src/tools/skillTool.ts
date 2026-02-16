import { ToolResult } from "../types";
import { SkillManager } from "../skills/skillManager";
import { getSkillHandlerToolName } from "../skills/toolNaming";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";

export class SkillTool {
  private readonly manager: SkillManager;

  constructor(manager: SkillManager) {
    this.manager = manager;
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
      const result = await this.manager.invoke(name, input, context);
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
      const result = await this.manager.invoke(skillName, input, context);
      return { ok: true, output: result };
    } catch (error) {
      return { ok: false, error: `Failed to execute skill '${skillName}': ${(error as Error).message}` };
    }
  }
}

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const manager = deps.skillManager as SkillManager;
  const tool = new SkillTool(manager);

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
  }
}
