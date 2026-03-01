import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export type TestCommandDefinition = {
  name: string;
  command: string;
  args: string[];
  timeoutMs?: number;
};

export type TestCommandResult = {
  name: string;
  command: string;
  args: string[];
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type TestRunResult = {
  ok: boolean;
  summary: string;
  commands: TestCommandResult[];
};

type PackageJsonShape = {
  scripts?: Record<string, string>;
};

type TestRunnerOptions = {
  rootDir: string;
  defaultTimeoutMs: number;
};

export class TestRunner {
  private readonly options: TestRunnerOptions;

  constructor(options?: Partial<TestRunnerOptions>) {
    this.options = {
      rootDir: options?.rootDir ?? process.cwd(),
      defaultTimeoutMs: options?.defaultTimeoutMs ?? parseInt(process.env.EVOLUTION_TEST_TIMEOUT_MS ?? "300000", 10)
    };
  }

  async run(): Promise<TestRunResult> {
    const commands = this.resolveCommands();
    const results: TestCommandResult[] = [];

    for (const item of commands) {
      const result = await runCommand(item, this.options.rootDir, this.options.defaultTimeoutMs);
      results.push(result);
      if (!result.ok) {
        // Continue collecting full diagnostics for repair prompts.
      }
    }

    const failures = results.filter((item) => !item.ok);
    if (failures.length === 0) {
      return {
        ok: true,
        summary: `Checks passed (${results.map((item) => item.name).join(", ")})`,
        commands: results
      };
    }

    const summaryLines: string[] = [];
    for (const failed of failures) {
      const detail = [failed.stderr, failed.stdout].filter(Boolean).join("\n").trim();
      summaryLines.push(`- ${failed.name} failed: ${trimText(detail || "no output", 1200)}`);
    }

    return {
      ok: false,
      summary: summaryLines.join("\n"),
      commands: results
    };
  }

  private resolveCommands(): TestCommandDefinition[] {
    const scripts = readPackageScripts(path.join(this.options.rootDir, "package.json"));
    const commands: TestCommandDefinition[] = [];

    if (scripts.test) {
      commands.push({
        name: "npm test",
        command: "npm",
        args: ["run", "-s", "test"]
      });
    }

    if (scripts.lint) {
      commands.push({
        name: "npm lint",
        command: "npm",
        args: ["run", "-s", "lint"]
      });
    }

    if (scripts.typecheck) {
      commands.push({
        name: "npm typecheck",
        command: "npm",
        args: ["run", "-s", "typecheck"]
      });
    } else {
      const localTsc = resolveLocalTsc(this.options.rootDir);
      if (localTsc) {
        commands.push({
          name: "tsc --noEmit",
          command: localTsc,
          args: ["-p", "tsconfig.json", "--noEmit"]
        });
      } else {
        commands.push({
          name: "npm build",
          command: "npm",
          args: ["run", "-s", "build"]
        });
      }
    }

    return commands;
  }
}

function readPackageScripts(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PackageJsonShape;
    return parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function resolveLocalTsc(rootDir: string): string | null {
  const unixPath = path.join(rootDir, "node_modules", ".bin", "tsc");
  const winPath = path.join(rootDir, "node_modules", ".bin", "tsc.cmd");
  if (fs.existsSync(unixPath)) {
    return unixPath;
  }
  if (fs.existsSync(winPath)) {
    return winPath;
  }
  return null;
}

async function runCommand(
  definition: TestCommandDefinition,
  cwd: string,
  fallbackTimeoutMs: number
): Promise<TestCommandResult> {
  const timeoutMs = Math.max(1000, definition.timeoutMs ?? fallbackTimeoutMs);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(definition.command, definition.args, {
      cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timeoutTriggered = false;

    const timer = setTimeout(() => {
      if (finished) return;
      timeoutTriggered = true;
      finished = true;
      child.kill("SIGKILL");
      resolve({
        name: definition.name,
        command: definition.command,
        args: definition.args.slice(),
        ok: false,
        exitCode: null,
        signal: "SIGKILL",
        durationMs: Date.now() - startedAt,
        stdout: trimText(stdout, 5000),
        stderr: trimText(`${stderr}\nCommand timeout after ${timeoutMs}ms`, 5000)
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      stdout = trimText(stdout, 20000);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      stderr = trimText(stderr, 20000);
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        name: definition.name,
        command: definition.command,
        args: definition.args.slice(),
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        stdout: trimText(stdout, 5000),
        stderr: trimText(`${stderr}\n${(error as Error).message}`, 5000)
      });
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const ok = !timeoutTriggered && code === 0;
      resolve({
        name: definition.name,
        command: definition.command,
        args: definition.args.slice(),
        ok,
        exitCode: typeof code === "number" ? code : null,
        signal,
        durationMs: Date.now() - startedAt,
        stdout: trimText(stdout, 5000),
        stderr: trimText(stderr, 5000)
      });
    });
  });
}

function trimText(text: string, maxLength: number): string {
  const value = String(text ?? "");
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(value.length - maxLength);
}
