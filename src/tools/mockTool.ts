import { ToolResult } from "../types";

export class MockTool {
  async execute(_op: string, _args: Record<string, unknown>, _context: Record<string, unknown>): Promise<ToolResult> {
    return { ok: true, output: { mocked: true } };
  }
}
