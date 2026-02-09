import { Action, ActionType, ToolResult } from "../types";
import { SkillManager } from "../skills/skillManager";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import { execFile } from "child_process";

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
    } catch {
      const skill = this.manager.get(name);
      if (!skill) {
        return { ok: false, error: `Skill '${name}' not found` };
      }
      if (!skill.terminal) {
        return { ok: false, error: `Skill '${name}' has no handler` };
      }
      const cmd = skill.command ?? name;
      const args = parseArgs(input);
      const output = await runCommand(cmd, args);
      return { ok: true, output: { text: output } };
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

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if ((ch === "\"" || ch === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (inQuotes && ch === quoteChar) {
      inQuotes = false;
      quoteChar = "";
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) args.push(current);
  return args;
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr && stderr.trim() ? stderr.trim() : err.message;
        reject(new Error(msg));
        return;
      }
      const out = stdout.toString().trim();
      resolve(out || "OK");
    });
  });
}
