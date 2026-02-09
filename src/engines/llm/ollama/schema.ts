import { ToolRegistry } from "../../../tools/toolRegistry";

export function buildToolSchema(registry: ToolRegistry): string {
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
    tools: registry.listSchema()
  };

  return JSON.stringify(schema, null, 2);
}
