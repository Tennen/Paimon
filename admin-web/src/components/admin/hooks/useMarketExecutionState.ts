import { useEffect, useMemo, useState } from "react";
import type {
  MarketPhase,
  MarketRunOnceResponse,
  MarketRunSummary,
  Notice,
  PushUser,
  ScheduledTask
} from "@/types/admin";
import { request } from "./adminApi";
import { toMarketErrorText } from "./marketAdminUtils";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type UseMarketExecutionStateArgs = {
  users: PushUser[];
  loadTasks: () => Promise<void>;
  setNotice: NoticeSetter;
};

export function useMarketExecutionState(args: UseMarketExecutionStateArgs) {
  const [marketRuns, setMarketRuns] = useState<MarketRunSummary[]>([]);
  const [bootstrappingMarketTasks, setBootstrappingMarketTasks] = useState(false);
  const [runningMarketOncePhase, setRunningMarketOncePhase] = useState<MarketPhase | null>(null);
  const [marketTaskUserId, setMarketTaskUserId] = useState("");
  const [marketMiddayTime, setMarketMiddayTime] = useState("13:30");
  const [marketCloseTime, setMarketCloseTime] = useState("15:15");

  const enabledUsers = useMemo(() => args.users.filter((user) => user.enabled), [args.users]);

  useEffect(() => {
    if (!marketTaskUserId) {
      setMarketTaskUserId(enabledUsers[0]?.id ?? "");
      return;
    }
    if (!args.users.some((user) => user.id === marketTaskUserId)) {
      setMarketTaskUserId(enabledUsers[0]?.id ?? "");
    }
  }, [args.users, enabledUsers, marketTaskUserId]);

  async function loadMarketRuns(): Promise<void> {
    const payload = await request<{ runs: MarketRunSummary[] }>("/admin/api/market/runs?limit=12");
    setMarketRuns(Array.isArray(payload.runs) ? payload.runs : []);
  }

  async function handleBootstrapMarketTasks(): Promise<void> {
    if (!marketTaskUserId) {
      args.setNotice({ type: "error", title: "请先选择推送用户" });
      return;
    }

    setBootstrappingMarketTasks(true);
    try {
      await request<{ ok: boolean; tasks: ScheduledTask[] }>("/admin/api/market/tasks/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          userId: marketTaskUserId,
          middayTime: marketMiddayTime,
          closeTime: marketCloseTime,
          enabled: true
        })
      });
      await args.loadTasks();
      args.setNotice({
        type: "success",
        title: "Market 定时任务已创建/更新",
        text: "已生成 /market midday 和 /market close 两条每日任务"
      });
    } catch (error) {
      args.setNotice({ type: "error", title: "创建 Market 定时任务失败", text: toMarketErrorText(error) });
    } finally {
      setBootstrappingMarketTasks(false);
    }
  }

  async function handleRunMarketOnce(phase: MarketPhase): Promise<void> {
    if (!marketTaskUserId) {
      args.setNotice({ type: "error", title: "请先选择推送用户" });
      return;
    }
    if (runningMarketOncePhase) {
      return;
    }

    setRunningMarketOncePhase(phase);
    try {
      const payload = await request<MarketRunOnceResponse>("/admin/api/market/run-once", {
        method: "POST",
        body: JSON.stringify({
          userId: marketTaskUserId,
          phase
        })
      });
      await loadMarketRuns();
      args.setNotice({
        type: payload.acceptedAsync ? "info" : "success",
        title: payload.acceptedAsync ? "Market 报告已异步受理" : "Market 报告已生成",
        text: payload.responseText || payload.message
      });
    } catch (error) {
      args.setNotice({ type: "error", title: "手动触发 Market 报告失败", text: toMarketErrorText(error) });
    } finally {
      setRunningMarketOncePhase((current) => (current === phase ? null : current));
    }
  }

  return {
    marketRuns,
    bootstrappingMarketTasks,
    runningMarketOncePhase,
    enabledUsers,
    marketTaskUserId,
    marketMiddayTime,
    marketCloseTime,
    setMarketTaskUserId,
    setMarketMiddayTime,
    setMarketCloseTime,
    loadMarketRuns,
    handleBootstrapMarketTasks,
    handleRunMarketOnce
  };
}
