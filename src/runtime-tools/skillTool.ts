import { ToolResult } from "../types";
import { SkillManager } from "../skills/skillManager";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";

class SkillTool {
  private readonly manager: SkillManager;

  constructor(manager: SkillManager) {
    this.manager = manager;
  }

  async execute(op: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (op !== "describe") {
      return { ok: false, error: `Unsupported action: ${op}` };
    }

    const name = String(args.name ?? "").trim();
    if (!name) {
      return { ok: false, error: "Missing skill name" };
    }

    const skill = this.manager.get(name);
    if (!skill) {
      return { ok: false, error: `Unknown skill: ${name}` };
    }

    return {
      ok: true,
      output: {
        name: skill.name,
        description: skill.description,
        runtimeTool: skill.runtimeTool ?? "",
        runtimeAction: skill.runtimeAction ?? "execute",
        runtimeParams: skill.runtimeParams ?? ["input"]
      }
    };
  }
}

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const manager = deps.skillManager as SkillManager;
  const tool = new SkillTool(manager);

  registry.register(
    {
      name: "skill",
      execute: (op, args) => tool.execute(op, args)
    },
    {
      name: "skill",
      description: "Inspect skill runtime contracts.",
      operations: [
        {
          op: "describe",
          description: "Get runtime tool contract for a skill.",
          params: {
            name: "string"
          }
        }
      ]
    }
  );
}
