import { useState } from "react";
import type { Notice } from "@/types/admin";
import type { SystemOperationState } from "../SystemSection";
import { request } from "./adminApi";
import { isLikelyRestartConnectionDrop } from "./systemAdminUtils";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type UseSystemOperationsStateArgs = {
  setNotice: NoticeSetter;
};

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export function useSystemOperationsState(args: UseSystemOperationsStateArgs) {
  const [systemOperationState, setSystemOperationState] = useState<SystemOperationState>({
    restarting: false,
    pullingRepo: false,
    buildingRepo: false,
    deployingRepo: false
  });

  async function handleRestartPm2(): Promise<void> {
    setSystemOperationState((prev) => ({ ...prev, restarting: true }));
    try {
      const payload = await request<{ output?: string; accepted?: boolean; delayMs?: number }>("/admin/api/restart", {
        method: "POST",
        body: "{}"
      });
      const delayText = payload.delayMs && payload.delayMs > 0 ? `，预计 ${payload.delayMs}ms 后执行` : "";
      args.setNotice({
        type: "info",
        title: payload.accepted ? "重启指令已受理" : "应用进程重启完成",
        text: payload.output
          ? `${payload.output}${delayText}`
          : `服务可能会短暂断连，属于正常现象${delayText}`
      });
    } catch (error) {
      if (isLikelyRestartConnectionDrop(error)) {
        args.setNotice({
          type: "info",
          title: "重启过程中连接中断",
          text: "已触发 pm2 restart，请稍等 3-10 秒后刷新页面。"
        });
      } else {
        args.setNotice({ type: "error", title: "pm2 重启失败", text: toErrorText(error) });
      }
    } finally {
      setSystemOperationState((prev) => ({ ...prev, restarting: false }));
    }
  }

  async function handlePullRepo(): Promise<void> {
    setSystemOperationState((prev) => ({ ...prev, pullingRepo: true }));
    try {
      const payload = await request<{
        ok: boolean;
        cwd: string;
        pullCommand: string;
        pullOutput: string;
      }>("/admin/api/repo/pull", {
        method: "POST",
        body: "{}"
      });
      args.setNotice({
        type: "success",
        title: "远端代码同步完成",
        text: [`执行命令: ${payload.pullCommand}`, `工作目录: ${payload.cwd}`, payload.pullOutput].filter(Boolean).join("\n\n")
      });
    } catch (error) {
      args.setNotice({ type: "error", title: "同步远端代码失败", text: toErrorText(error) });
    } finally {
      setSystemOperationState((prev) => ({ ...prev, pullingRepo: false }));
    }
  }

  async function handleBuildRepo(): Promise<void> {
    setSystemOperationState((prev) => ({ ...prev, buildingRepo: true }));
    try {
      const payload = await request<{
        ok: boolean;
        cwd: string;
        installCommand: string;
        installOutput: string;
        buildOutput: string;
      }>("/admin/api/repo/build", {
        method: "POST",
        body: "{}"
      });
      args.setNotice({
        type: "success",
        title: "依赖安装 + 项目构建完成",
        text: [
          `工作目录: ${payload.cwd}`,
          `执行命令: ${payload.installCommand}`,
          payload.installOutput,
          payload.buildOutput
        ]
          .filter(Boolean)
          .join("\n\n")
      });
    } catch (error) {
      args.setNotice({ type: "error", title: "执行项目构建失败", text: toErrorText(error) });
    } finally {
      setSystemOperationState((prev) => ({ ...prev, buildingRepo: false }));
    }
  }

  async function handleDeployRepo(): Promise<void> {
    setSystemOperationState((prev) => ({ ...prev, deployingRepo: true }));
    try {
      const payload = await request<{
        ok: boolean;
        cwd: string;
        pullCommand: string;
        pullOutput: string;
        installCommand: string;
        installOutput: string;
        buildOutput: string;
        restartOutput: string;
      }>("/admin/api/repo/deploy", {
        method: "POST",
        body: "{}"
      });
      args.setNotice({
        type: "success",
        title: "一键部署完成",
        text: [
          `执行命令: ${payload.pullCommand}`,
          `工作目录: ${payload.cwd}`,
          payload.pullOutput,
          `执行命令: ${payload.installCommand}`,
          payload.installOutput,
          payload.buildOutput,
          payload.restartOutput
        ]
          .filter(Boolean)
          .join("\n\n")
      });
    } catch (error) {
      args.setNotice({ type: "error", title: "一键部署失败", text: toErrorText(error) });
    } finally {
      setSystemOperationState((prev) => ({ ...prev, deployingRepo: false }));
    }
  }

  return {
    systemOperationState,
    handleRestartPm2,
    handlePullRepo,
    handleBuildRepo,
    handleDeployRepo
  };
}
