import { executeAction, buildHelpText, SystemMaintenanceAction } from "../integrations/system-maintenance/service";
import { ToolRegistry } from "../tools/toolRegistry";

export function registerSystemShortcuts(registry: ToolRegistry): void {
  registry.registerDirectShortcut({
    command: "/sync",
    async: true,
    acceptedText: "收到，开始同步代码，完成后回传结果。",
    execute: async () => executeAction("sync")
  });

  registry.registerDirectShortcut({
    command: "/build",
    async: true,
    acceptedText: "收到，开始安装依赖并执行项目构建，完成后回传结果。",
    execute: async () => executeAction("build")
  });

  registry.registerDirectShortcut({
    command: "/restart",
    async: true,
    acceptedText: "收到，开始重启服务，完成后回传结果。",
    execute: async () => executeAction("restart")
  });

  registry.registerDirectShortcut({
    command: "/deploy",
    async: true,
    acceptedText: "收到，开始执行同步 + 安装依赖 + 构建 + 重启，完成后回传结果。",
    execute: async () => executeAction("deploy")
  });

  registry.registerDirectShortcut({
    command: "/system",
    async: true,
    acceptedText: "收到，开始执行系统命令，完成后回传结果。",
    execute: async (context) => {
      const action = parseSystemAction(context.rest);
      if (!action) {
        return {
          ok: true,
          output: {
            text: buildHelpText()
          }
        };
      }
      return executeAction(action);
    }
  });
}

function parseSystemAction(raw: string): SystemMaintenanceAction | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || ["help", "h", "?"].includes(value)) {
    return null;
  }
  if (["sync", "pull", "update"].includes(value)) {
    return "sync";
  }
  if (["build", "compile"].includes(value)) {
    return "build";
  }
  if (["restart", "reload"].includes(value)) {
    return "restart";
  }
  if (["deploy", "all"].includes(value)) {
    return "deploy";
  }
  return null;
}
