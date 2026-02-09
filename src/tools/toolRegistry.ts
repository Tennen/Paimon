import fs from "fs";
import path from "path";
import { Action, ToolResult } from "../types";
import { LLMRuntimeContext } from "../engines/llm/llm";

export type ToolHandler = {
  name: string;
  execute: (action: Action, context: Record<string, unknown>) => Promise<ToolResult>;
  runtimeContext?: () => ToolRuntimeContext;
  followupContext?: (action: Action) => Partial<LLMRuntimeContext> | null;
};

export type ToolSchemaItem = {
  name: string;
  resource?: string;
  operations: Array<{ op: string; params: Record<string, string> }>;
};

export type ToolDependencies = {
  skillManager: unknown;
};

export type ToolModule = {
  registerTool: (registry: ToolRegistry, deps: ToolDependencies) => void;
};

export type ToolRuntimeContext = Record<string, unknown>;

export class ToolRegistry {
  private handlers: ToolHandler[] = [];
  private schema: ToolSchemaItem[] = [];

  register(handler: ToolHandler, schema?: ToolSchemaItem | ToolSchemaItem[]): void {
    this.handlers.push(handler);
    if (schema) {
      const items = Array.isArray(schema) ? schema : [schema];
      this.schema.push(...items);
    }
  }

  listHandlers(): ToolHandler[] {
    return this.handlers.slice();
  }

  listSchema(): ToolSchemaItem[] {
    return this.schema.slice();
  }

  buildRuntimeContext(): Record<string, ToolRuntimeContext> {
    const merged: Record<string, ToolRuntimeContext> = {};
    for (const handler of this.handlers) {
      if (handler.runtimeContext) {
        merged[handler.name] = handler.runtimeContext();
      }
    }
    return merged;
  }

}

export function loadTools(registry: ToolRegistry, deps: ToolDependencies): void {
  const toolsDir = path.resolve(__dirname, "../tools");
  if (!fs.existsSync(toolsDir)) {
    return;
  }

  const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;
    if (!entry.name.endsWith("Tool.ts") && !entry.name.endsWith("Tool.js")) continue;

    const fullPath = path.join(toolsDir, entry.name);
    try {
      const mod = require(fullPath) as ToolModule;
      if (mod && typeof mod.registerTool === "function") {
        mod.registerTool(registry, deps);
      }
    } catch {
      // ignore load errors
    }
  }
}
