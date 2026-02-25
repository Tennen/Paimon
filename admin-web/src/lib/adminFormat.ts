import { EvolutionGoalStatus } from "@/types/admin";

export function formatDateTime(input: string | undefined): string {
  if (!input) {
    return "-";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

export function formatEvolutionStatus(status: EvolutionGoalStatus): string {
  if (status === "pending") return "待执行";
  if (status === "running") return "执行中";
  if (status === "waiting_retry") return "等待重试";
  if (status === "succeeded") return "成功";
  return "失败";
}

export function getEvolutionStatusBadgeVariant(
  status: EvolutionGoalStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "succeeded") return "default";
  if (status === "failed") return "destructive";
  if (status === "running") return "outline";
  return "secondary";
}
