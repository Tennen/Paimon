import { Action, ActionType, ToolResult } from "./types";
import { ToolRegistry } from "./tools/toolRegistry";

export class ToolRouter {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async route(action: Action, context: Record<string, unknown>): Promise<{ result: ToolResult; toolName: string }> {
    if (action.type === ActionType.ToolCall) {
      const name = action.params.tool as string | undefined;
      if (name) {
        const handler = this.registry.listHandlers().find((h) => h.name === name);
        if (handler) {
          const result = await handler.execute(action, context);
          return { result, toolName: handler.name };
        }
      }
    }

    if (action.type === ActionType.SkillCall) {
      const handler = this.registry.listHandlers().find((h) => h.name === "skill");
      if (handler) {
        const result = await handler.execute(action, context);
        return { result, toolName: handler.name };
      }
    }

    const result: ToolResult = {
      ok: true,
      output: {
        text: `No matching tool for action: ${action.type}`,
        unmatched_action: action
      }
    };
    return { result, toolName: "unmatched" };
  }
}
