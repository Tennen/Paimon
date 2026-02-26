import { ToolResult } from "../types";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import { execFile } from "child_process";

export class TerminalCommandTool {
  async execute(op: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (op === "exec") {
      const command = args.command as string | undefined;
      if (!command) {
        return { ok: false, error: "Missing command" };
      }

      try {
        const output = await runCommand(command);
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
      description: "Run local terminal commands on this machine.",
      resource: "system",
      operations: [
        {
          op: "exec",
          description: "Execute one command line. Put executable and all flags/arguments together in args.command.",
          params: {
            command: "string"
          },
          param_descriptions: {
            command: "Full command line, for example: remindctl today --json"
          }
        }
      ]
    }
  );
}

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoteChar: "'" | "\"" | null = null;
  let escaped = false;
  let tokenStarted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escaped) {
      current += ch;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quoteChar !== "'") {
      escaped = true;
      continue;
    }
    if (quoteChar) {
      if (ch === quoteChar) {
        quoteChar = null;
        tokenStarted = true;
        continue;
      }
      current += ch;
      tokenStarted = true;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quoteChar = ch;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    current += ch;
    tokenStarted = true;
  }

  if (escaped) {
    current += "\\";
    tokenStarted = true;
  }
  if (quoteChar) {
    throw new Error(`Unterminated quote in command: ${quoteChar}`);
  }
  if (tokenStarted) {
    args.push(current);
  }
  return args;
}

function runCommand(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = parseArgs(cmd.trim());
    const baseCommand = parsed.shift();
    if (!baseCommand) {
      reject(new Error("Missing command"));
      return;
    }
    const finalArgs = parsed;

    execFile(baseCommand, finalArgs, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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
