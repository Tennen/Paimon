import { exec } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../../types";

const execAsync = promisify(exec);
const COMMAND_OUTPUT_MAX = 12000;

export type SystemMaintenanceAction = "sync" | "build" | "restart" | "deploy";

export async function executeAction(action: SystemMaintenanceAction): Promise<ToolResult> {
  try {
    if (action === "sync") {
      const result = await syncRepoWithRebase();
      return {
        ok: true,
        output: {
          text: [
            "代码同步完成",
            `cwd: ${result.cwd}`,
            `command: ${result.pullCommand}`,
            result.pullOutput ? `output:\n${result.pullOutput}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        }
      };
    }

    if (action === "build") {
      const result = await buildProject();
      return {
        ok: true,
        output: {
          text: [
            "依赖安装 + 项目构建完成",
            `cwd: ${result.cwd}`,
            `install_command: ${result.installCommand}`,
            result.installOutput ? `install_output:\n${result.installOutput}` : "",
            result.buildOutput ? `output:\n${result.buildOutput}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        }
      };
    }

    if (action === "restart") {
      const output = await restartService();
      return {
        ok: true,
        output: {
          text: [
            "服务重启完成",
            output ? `output:\n${output}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        }
      };
    }

    const sync = await syncRepoWithRebase();
    const build = await buildProject();
    const restart = await restartService();
    return {
      ok: true,
      output: {
        text: [
          "同步 + 安装依赖 + 构建 + 重启完成",
          `cwd: ${sync.cwd}`,
          `sync_command: ${sync.pullCommand}`,
          sync.pullOutput ? `sync_output:\n${sync.pullOutput}` : "",
          `install_command: ${build.installCommand}`,
          build.installOutput ? `install_output:\n${build.installOutput}` : "",
          build.buildOutput ? `build_output:\n${build.buildOutput}` : "",
          restart ? `restart_output:\n${restart}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message ?? "system maintenance failed"
    };
  }
}

export function buildHelpText(): string {
  return [
    "系统快捷命令：",
    "- /sync: 同步代码（优先 gpr，失败自动回退 git pull --rebase）",
    "- /build: 安装依赖并构建项目（npm install + npm run build）",
    "- /restart: 重启服务（pm2 restart 0）",
    "- /deploy: 同步 + 安装依赖 + 构建 + 重启",
    "- /system help: 查看帮助"
  ].join("\n");
}

async function restartService(): Promise<string> {
  const result = await runCommandWithOutput("pm2 restart 0");
  if (!result.ok) {
    throw new Error(`pm2 restart 0 failed:\n${joinCommandOutput(result) || result.error || "unknown error"}`);
  }
  return joinCommandOutput(result);
}

async function syncRepoWithRebase(): Promise<{
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

async function buildProject(): Promise<{
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
      stdout: clampOutput((stdout ?? "").trim()),
      stderr: clampOutput((stderr ?? "").trim()),
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
      stdout: clampOutput((detail.stdout ?? "").toString().trim()),
      stderr: clampOutput((detail.stderr ?? "").toString().trim()),
      error: String(detail.message ?? "command failed")
    };
  }
}

function joinCommandOutput(result: { stdout: string; stderr: string; error: string }): string {
  return clampOutput([result.stdout, result.stderr].filter(Boolean).join("\n").trim());
}

function isGprNotFound(result: { stdout: string; stderr: string; error: string }): boolean {
  const text = `${result.stdout}\n${result.stderr}\n${result.error}`.toLowerCase();
  if (!text.includes("gpr")) {
    return false;
  }
  return text.includes("not found") || text.includes("command not found");
}

function clampOutput(text: string): string {
  if (text.length <= COMMAND_OUTPUT_MAX) {
    return text;
  }
  return `${text.slice(0, Math.max(0, COMMAND_OUTPUT_MAX - 1)).trimEnd()}…`;
}
