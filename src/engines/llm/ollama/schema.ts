import { ToolRegistry } from "../../../tools/toolRegistry";
import { SkillManager } from "../../../skills/skillManager";

export function buildToolSchema(registry: ToolRegistry, skillManager?: SkillManager): string {
  const schema = {
    actions: [
      {
        type: "tool.call",
        params: {
          tool: "string",
          op: "string",
          args: "object"
        }
      },
      {
        type: "skill.call",
        params: {
          name: "string",
          input: "string"
        }
      },
      {
        type: "respond",
        params: {
          text: "string"
        }
      }
    ],
    tools: registry.listSchema(),
    skills: skillManager?.list() || []
  };

  return JSON.stringify(schema, null, 2);
}
