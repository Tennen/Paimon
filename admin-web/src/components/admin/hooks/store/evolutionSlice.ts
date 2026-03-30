import type { EvolutionGoal } from "@/types/admin";
import { request } from "../adminApi";
import type { AdminEvolutionSlice } from "./slices";
import type { AdminSliceCreator } from "./types";

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export const createEvolutionSlice: AdminSliceCreator<AdminEvolutionSlice> = (set, get) => ({
  evolutionSnapshot: null,
  loadingEvolution: false,
  evolutionGoalDraft: "",
  evolutionCommitDraft: "",
  submittingEvolutionGoal: false,
  triggeringEvolutionTick: false,
  setEvolutionGoalDraft: (value) => {
    set({ evolutionGoalDraft: value });
  },
  setEvolutionCommitDraft: (value) => {
    set({ evolutionCommitDraft: value });
  },
  loadEvolutionState: async (options) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      set({ loadingEvolution: true });
    }
    try {
      const payload = await request("/admin/api/evolution/state");
      set({ evolutionSnapshot: payload });
    } finally {
      if (!silent) {
        set({ loadingEvolution: false });
      }
    }
  },
  handleSubmitEvolutionGoal: async (event) => {
    event.preventDefault();
    const goal = get().evolutionGoalDraft.trim();
    const commitMessage = get().evolutionCommitDraft.trim();

    if (!goal) {
      get().setNotice({ type: "error", title: "请先输入 Goal 需求" });
      return;
    }

    set({ submittingEvolutionGoal: true });
    try {
      const payload = await request<{ ok: boolean; goal: EvolutionGoal }>("/admin/api/evolution/goals", {
        method: "POST",
        body: JSON.stringify({
          goal,
          ...(commitMessage ? { commitMessage } : {})
        })
      });
      await get().loadEvolutionState({ silent: true });
      set({ evolutionGoalDraft: "" });
      get().setNotice({
        type: "success",
        title: "Evolution Goal 已入队",
        text: `${payload.goal.id} (${payload.goal.status})`
      });
    } catch (error) {
      get().setNotice({ type: "error", title: "提交 Evolution Goal 失败", text: toErrorText(error) });
    } finally {
      set({ submittingEvolutionGoal: false });
    }
  },
  handleTriggerEvolutionTick: async () => {
    set({ triggeringEvolutionTick: true });
    try {
      await request<{ ok: boolean }>("/admin/api/evolution/tick", {
        method: "POST",
        body: "{}"
      });
      await get().loadEvolutionState({ silent: true });
      get().setNotice({ type: "success", title: "已触发 Evolution Tick" });
    } catch (error) {
      get().setNotice({ type: "error", title: "触发 Evolution Tick 失败", text: toErrorText(error) });
    } finally {
      set({ triggeringEvolutionTick: false });
    }
  }
});
