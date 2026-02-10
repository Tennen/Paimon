import { Action, ActionType, ToolResult } from "../types";
import { SkillManager } from "../skills/skillManager";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";

export class SkillTool {
  private readonly manager: SkillManager;

  constructor(manager: SkillManager) {
    this.manager = manager;
  }

  async execute(action: Action, context: Record<string, unknown>): Promise<ToolResult> {
    if (action.type !== ActionType.SkillCall) {
      return { ok: false, error: `Unsupported action: ${action.type}` };
    }

    const name = action.params.name as string | undefined;
    const input = (action.params.input as string | undefined) ?? "";

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
}

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const manager = deps.skillManager as SkillManager;
  const tool = new SkillTool(manager);

  registry.register({
    name: "skill",
    execute: (action, context) => tool.execute(action, context),
  });
}
