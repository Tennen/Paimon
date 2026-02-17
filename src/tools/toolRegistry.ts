import fs from "fs";
import path from "path";
import { ToolResult } from "../types";
import { LLMRuntimeContext } from "../engines/llm/llm";

export type ToolHandler = {
  name: string;
  execute: (op: string, args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResult>;
  runtimeContext?: () => ToolRuntimeContext;
  followupContext?: (op: string, args: Record<string, unknown>) => Partial<LLMRuntimeContext> | null;
};

export type ToolSchemaItem = {
  name: string;
  resource?: string;
  operations: Array<{ op: string; params: Record<string, string> }>;
  keywords?: string[];
};

export type ToolDependencies = {
  skillManager: unknown;
};

export type ToolModule = {
  registerTool: (registry: ToolRegistry, deps: ToolDependencies) => void;
};

export type ToolRuntimeContext = Record<string, unknown>;

export type DirectToolCallRoute = {
  command: string;
  tool: string;
  op: string;
  preferToolResult?: boolean;
  async?: boolean;
  acceptedText?: string;
  acceptedDelayMs?: number;
  argName?: string;
  argMode?: "full_input" | "rest";
};

export type DirectToolCallMatch = {
  command: string;
  tool: string;
  op: string;
  args: Record<string, unknown>;
  preferToolResult: boolean;
  async: boolean;
  acceptedText: string;
  acceptedDelayMs: number;
};

export class ToolRegistry {
  private handlers: ToolHandler[] = [];
  private schema: ToolSchemaItem[] = [];
  private directToolCalls: DirectToolCallRoute[] = [];

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
    const merged: Record<string, ToolRuntimeContext> = {
      _tools: { schema: this.listSchema() }
    };
    for (const handler of this.handlers) {
      if (handler.runtimeContext) {
        merged[handler.name] = handler.runtimeContext();
      }
    }
    return merged;
  }

  registerDirectToolCall(route: DirectToolCallRoute): void {
    const command = normalizeDirectCommand(route.command);
    if (!command) return;
    const normalized: DirectToolCallRoute = {
      ...route,
      command,
      argName: route.argName ?? "input",
      argMode: route.argMode ?? "full_input"
    };
    this.directToolCalls = this.directToolCalls.filter((item) => item.command !== command);
    this.directToolCalls.push(normalized);
  }

  listDirectToolCalls(): DirectToolCallRoute[] {
    return this.directToolCalls.slice();
  }

  matchDirectToolCall(input: string): DirectToolCallMatch | null {
    const raw = String(input ?? "").trim();
    if (!raw.startsWith("/")) {
      return null;
    }

    const commandToken = raw.split(/\s+/, 1)[0].toLowerCase();
    const route = this.directToolCalls.find((item) => item.command === commandToken);
    if (!route) {
      return null;
    }

    const rest = raw.slice(commandToken.length).trim();
    const argName = route.argName ?? "input";
    const argValue = route.argMode === "rest" ? rest : raw;
    return {
      command: commandToken,
      tool: route.tool,
      op: route.op,
      args: {
        [argName]: argValue
      },
      preferToolResult: route.preferToolResult ?? true,
      async: route.async ?? false,
      acceptedText: route.acceptedText ?? "任务已受理，正在处理中，稍后回调结果。",
      acceptedDelayMs: normalizeAcceptedDelayMs(route.acceptedDelayMs, route.async ?? false)
    };
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

function normalizeDirectCommand(raw: string): string {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return "";
  if (!text.startsWith("/")) return "";
  return text.split(/\s+/, 1)[0];
}

function normalizeAcceptedDelayMs(raw: number | undefined, isAsync: boolean): number {
  if (!isAsync) return 0;
  const fallback = 20000;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const value = Math.floor(raw);
  if (value < 0) return 0;
  return value;
}
