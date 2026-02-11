import { ToolResult } from "../types";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import { execFile } from "child_process";

export class TerminalCommandTool {
  async execute(op: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (op === "exec") {
      const command = args.command as string | undefined;
      const argsList = args.args as string[] | undefined;

      if (!command) {
        return { ok: false, error: "Missing command" };
      }

      try {
        const output = await runCommand(command, argsList || []);
        return { ok: true, output: { text: output } };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }

    return { ok: false, error: `Unsupported op: ${op ?? "unknown"}` };
  }
}

export function registerTool(registry: ToolRegistry, _deps: ToolDependencies): void {
  const tool = new TerminalCommandTool();

  registry.register(
    {
      name: "terminal",
      execute: (op, args, _context) => tool.execute(op, args),
    },
    {
      name: "terminal",
      resource: "system",
      operations: [
        {
          op: "exec",
          params: {
            command: "string",
            args: "string[]"
          }
        }
      ]
    }
  );
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
