import type { MarketPhase, MarketRunOnceResponse, MarketRunSummary, ScheduledTask } from "@/types/admin";
import { request } from "../adminApi";
import { toMarketErrorText } from "../marketAdminUtils";
import type { AdminMarketExecutionSlice } from "./slices";
import type { AdminSliceCreator } from "./types";

export const createMarketExecutionSlice: AdminSliceCreator<AdminMarketExecutionSlice> = (set, get) => ({
  marketRuns: [],
  bootstrappingMarketTasks: false,
  runningMarketOncePhase: null,
  marketTaskUserId: "",
  marketMiddayTime: "13:30",
  marketCloseTime: "15:15",
  syncMarketTaskUserSelection: () => {
    const users = get().users;
    const enabledUsers = users.filter((user) => user.enabled);
    const currentUserId = get().marketTaskUserId;
    const hasCurrent = Boolean(currentUserId && users.some((user) => user.id === currentUserId));
    const nextUserId = hasCurrent ? currentUserId : (enabledUsers[0]?.id ?? "");
    if (nextUserId !== currentUserId) {
      set({ marketTaskUserId: nextUserId });
    }
  },
  setMarketTaskUserId: (value) => {
    set({ marketTaskUserId: value });
  },
  setMarketMiddayTime: (value) => {
    set({ marketMiddayTime: value });
  },
  setMarketCloseTime: (value) => {
    set({ marketCloseTime: value });
  },
  loadMarketRuns: async () => {
    const payload = await request<{ runs: MarketRunSummary[] }>("/admin/api/market/runs?limit=12");
    set({ marketRuns: Array.isArray(payload.runs) ? payload.runs : [] });
  },
  handleBootstrapMarketTasks: async () => {
    const marketTaskUserId = get().marketTaskUserId;
    if (!marketTaskUserId) {
      get().setNotice({ type: "error", title: "请先选择推送用户" });
      return;
    }

    set({ bootstrappingMarketTasks: true });
    try {
      await request<{ ok: boolean; tasks: ScheduledTask[] }>("/admin/api/market/tasks/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          userId: marketTaskUserId,
          middayTime: get().marketMiddayTime,
          closeTime: get().marketCloseTime,
          enabled: true
        })
      });
      await get().loadTasks();
      get().setNotice({
        type: "success",
        title: "Market 定时任务已创建/更新",
        text: "已生成 /market midday 和 /market close 两条每日任务"
      });
    } catch (error) {
      get().setNotice({ type: "error", title: "创建 Market 定时任务失败", text: toMarketErrorText(error) });
    } finally {
      set({ bootstrappingMarketTasks: false });
    }
  },
  handleRunMarketOnce: async (phase: MarketPhase) => {
    const marketTaskUserId = get().marketTaskUserId;
    if (!marketTaskUserId) {
      get().setNotice({ type: "error", title: "请先选择推送用户" });
      return;
    }
    if (get().runningMarketOncePhase) {
      return;
    }

    set({ runningMarketOncePhase: phase });
    try {
      const payload = await request<MarketRunOnceResponse>("/admin/api/market/run-once", {
        method: "POST",
        body: JSON.stringify({
          userId: marketTaskUserId,
          phase
        })
      });
      await get().loadMarketRuns();
      get().setNotice({
        type: payload.acceptedAsync ? "info" : "success",
        title: payload.acceptedAsync ? "Market 报告已异步受理" : "Market 报告已生成",
        text: payload.responseText || payload.message
      });
    } catch (error) {
      get().setNotice({ type: "error", title: "手动触发 Market 报告失败", text: toMarketErrorText(error) });
    } finally {
      set((state) => ({
        runningMarketOncePhase: state.runningMarketOncePhase === phase ? null : state.runningMarketOncePhase
      }));
    }
  }
});
