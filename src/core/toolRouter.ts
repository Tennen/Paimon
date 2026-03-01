import { ToolResult } from "../types";
import { ToolRegistry } from "../runtime-tools/toolRegistry";

export class ToolRouter {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async route(
    toolName: string,
    execution: { op: string; args: Record<string, unknown> },
    context: { memory: string; sessionId: string }
  ): Promise<{ result: ToolResult }> {
    const handler = this.registry.listHandlers().find((h) => h.name === toolName);
    if (handler) {
      const result = await handler.execute(execution.op, execution.args, context);
      return { result };
    }

    const result: ToolResult = {
      ok: true,
      output: {
        text: `No matching tool for: ${toolName}`
      }
    };
    return { result };
  }
}
