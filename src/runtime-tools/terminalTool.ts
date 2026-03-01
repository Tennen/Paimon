import { ToolResult } from "../types";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import { execFile } from "child_process";

export class TerminalCommandTool {
  async execute(op: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (op === "exec") {
      const rawCommand = args.command as string | undefined;
      if (!rawCommand || !rawCommand.trim()) {
        return { ok: false, error: "Missing command" };
      }

      try {
        const command = rawCommand.trim();
        const parsedRawArgs = parseRawArgs(args.args);
        const { baseCommand, finalArgs } = resolveCommandAndArgs(command, parsedRawArgs);
        const output = await runCommand(baseCommand, finalArgs);
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
          description: "Execute a command with structured argv. Prefer args array to preserve spaces in values.",
          params: {
            command: "string",
            args: "string[]?"
          },
          param_descriptions: {
            command: "Executable only, for example: remindctl. Legacy full command line is still accepted for compatibility.",
            args: "Optional argument array. Each element is one argument value; keep values with spaces as one element, e.g. \"2026-01-04 12:34\"."
          }
        }
      ]
    }
  );
}

function parseRawArgs(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item));
  }
  if (typeof input === "string") {
    return parseArgs(input);
  }
  return [];
}

function resolveCommandAndArgs(command: string, args: string[]): { baseCommand: string; finalArgs: string[] } {
  // Structured mode: command is executable and args is argv.
  if (!/\s/.test(command)) {
    return {
      baseCommand: command,
      finalArgs: args
    };
  }

  // Compatibility mode: command may still be a full command line.
  const parsed = parseArgs(command);
  const baseCommand = parsed.shift();
  if (!baseCommand) {
    throw new Error("Missing command");
  }
  return {
    baseCommand,
    finalArgs: parsed.concat(args)
  };
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

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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
