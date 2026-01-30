import { Action, ToolResult } from "../types";

export class MockTool {
  async execute(_action: Action): Promise<ToolResult> {
    return { ok: true, output: { mocked: true } };
  }
}
