import type { ConversationBenchmarkResponse } from "@/types/admin";
import { request } from "../adminApi";
import type { AdminPageSlice } from "./slices";
import type { AdminSliceCreator } from "./types";

export const createPageSlice: AdminSliceCreator<AdminPageSlice> = (set, get) => ({
  activeMenu: "system",
  notice: null,
  conversationBenchmarkResult: null,
  runningConversationBenchmark: false,
  setActiveMenu: (menu) => set({ activeMenu: menu }),
  setNotice: (notice) => set({ notice }),
  bootstrap: async () => {
    try {
      await get().loadConfig();
      await Promise.all([
        get().loadModels(),
        get().loadDirectInputMappings(),
        get().loadWeComMenu(),
        get().loadUsers(),
        get().loadTasks(),
        get().loadMarketConfig(),
        get().loadMarketRuns(),
        get().loadTopicSummaryConfig(),
        get().loadWritingTopics(),
        get().loadEvolutionState({ silent: true })
      ]);
      get().setNotice(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      get().setNotice({ type: "error", title: "初始化失败", text });
    }
  },
  runConversationBenchmark: async (input) => {
    set({ runningConversationBenchmark: true });
    try {
      const payload = await request<ConversationBenchmarkResponse>("/admin/api/conversation/benchmark", {
        method: "POST",
        body: JSON.stringify(input)
      });
      set({ conversationBenchmarkResult: payload });
      get().setNotice({ type: "success", title: "对话 Benchmark 已完成" });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      get().setNotice({ type: "error", title: "运行对话 Benchmark 失败", text });
    } finally {
      set({ runningConversationBenchmark: false });
    }
  }
});
