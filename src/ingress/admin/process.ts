import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function fetchOllamaModels(): Promise<{ baseUrl: string; models: string[] }> {
  const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const endpoint = `${baseUrl}/api/tags`;

  const response = await fetch(endpoint, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Failed to query Ollama models: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    models?: Array<{ name?: unknown; model?: unknown }>;
  };

  const names = Array.isArray(payload.models)
    ? payload.models
        .map((item) => {
          if (typeof item?.name === "string" && item.name.trim()) {
            return item.name.trim();
          }
          if (typeof item?.model === "string" && item.model.trim()) {
            return item.model.trim();
          }
          return "";
        })
        .filter(Boolean)
    : [];

  return {
    baseUrl,
    models: Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
  };
}

export async function restartPm2(): Promise<string> {
  const { stdout, stderr } = await execAsync("pm2 restart 0");
  return `${stdout ?? ""}${stderr ?? ""}`.trim();
}

export function schedulePm2Restart(delayMs = 700): { delayMs: number; scheduledAt: string } {
  const normalizedDelayMs = Number.isFinite(delayMs)
    ? Math.max(100, Math.min(10_000, Math.floor(delayMs)))
    : 700;
  const scheduledAt = new Date().toISOString();

  setTimeout(() => {
    void restartPm2().catch((error) => {
      console.error(`[admin] pm2 restart failed: ${(error as Error).message ?? "unknown error"}`);
    });
  }, normalizedDelayMs);

  return {
    delayMs: normalizedDelayMs,
    scheduledAt
  };
}

export async function pullRepoWithRebase(): Promise<{
  cwd: string;
  pullCommand: string;
  pullOutput: string;
}> {
  const cwd = process.cwd();
  const gprResult = await runCommandWithOutput("zsh -lic 'gpr'");

  let pullCommand = "gpr";
  let pullOutput = joinCommandOutput(gprResult);

  if (!gprResult.ok) {
    if (!isGprNotFound(gprResult)) {
      throw new Error(`gpr failed:\n${pullOutput || gprResult.error || "unknown error"}`);
    }

    const fallbackResult = await runCommandWithOutput("git pull --rebase");
    if (!fallbackResult.ok) {
      const fallbackOutput = joinCommandOutput(fallbackResult);
      throw new Error(`git pull --rebase failed:\n${fallbackOutput || fallbackResult.error || "unknown error"}`);
    }

    pullCommand = "git pull --rebase";
    pullOutput = [
      "gpr not found, fallback to git pull --rebase",
      joinCommandOutput(fallbackResult)
    ]
      .filter(Boolean)
      .join("\n");
  }

  return {
    cwd,
    pullCommand,
    pullOutput
  };
}

export async function buildProject(): Promise<{
  cwd: string;
  installCommand: string;
  installOutput: string;
  buildOutput: string;
}> {
  const cwd = process.cwd();
  const installCommand = "npm install";
  const installResult = await runCommandWithOutput(installCommand);
  if (!installResult.ok) {
    const installOutput = joinCommandOutput(installResult);
    throw new Error(`npm install failed:\n${installOutput || installResult.error || "unknown error"}`);
  }

  const buildResult = await runCommandWithOutput("npm run build");
  if (!buildResult.ok) {
    const buildOutput = joinCommandOutput(buildResult);
    throw new Error(`npm run build failed:\n${buildOutput || buildResult.error || "unknown error"}`);
  }
  return {
    cwd,
    installCommand,
    installOutput: joinCommandOutput(installResult),
    buildOutput: joinCommandOutput(buildResult)
  };
}

export async function pullBuildAndRestart(): Promise<{
  cwd: string;
  pullCommand: string;
  pullOutput: string;
  installCommand: string;
  installOutput: string;
  buildOutput: string;
  restartOutput: string;
}> {
  const pullResult = await pullRepoWithRebase();
  const buildResult = await buildProject();
  const restartOutput = await restartPm2();
  return {
    cwd: buildResult.cwd,
    pullCommand: pullResult.pullCommand,
    pullOutput: pullResult.pullOutput,
    installCommand: buildResult.installCommand,
    installOutput: buildResult.installOutput,
    buildOutput: buildResult.buildOutput,
    restartOutput
  };
}

async function runCommandWithOutput(command: string): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  error: string;
}> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 32 * 1024 * 1024
    });
    return {
      ok: true,
      stdout: (stdout ?? "").trim(),
      stderr: (stderr ?? "").trim(),
      error: ""
    };
  } catch (error) {
    const detail = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      ok: false,
      stdout: (detail.stdout ?? "").toString().trim(),
      stderr: (detail.stderr ?? "").toString().trim(),
      error: String(detail.message ?? "command failed")
    };
  }
}

function joinCommandOutput(result: { stdout: string; stderr: string; error: string }): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function isGprNotFound(result: { stdout: string; stderr: string; error: string }): boolean {
  const text = `${result.stdout}\n${result.stderr}\n${result.error}`.toLowerCase();
  if (!text.includes("gpr")) {
    return false;
  }
  return text.includes("not found") || text.includes("command not found");
}
