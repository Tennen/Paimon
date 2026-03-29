import { useState } from "react";
import type { EvolutionGoal, EvolutionStateSnapshot, Notice } from "@/types/admin";
import { request } from "./adminApi";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type UseEvolutionAdminStateArgs = {
  setNotice: NoticeSetter;
};

export function useEvolutionAdminState(args: UseEvolutionAdminStateArgs) {
  const [evolutionSnapshot, setEvolutionSnapshot] = useState<EvolutionStateSnapshot | null>(null);
  const [loadingEvolution, setLoadingEvolution] = useState(false);
  const [evolutionGoalDraft, setEvolutionGoalDraft] = useState("");
  const [evolutionCommitDraft, setEvolutionCommitDraft] = useState("");
  const [submittingEvolutionGoal, setSubmittingEvolutionGoal] = useState(false);
  const [triggeringEvolutionTick, setTriggeringEvolutionTick] = useState(false);

  async function loadEvolutionState(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoadingEvolution(true);
    }
    try {
      const payload = await request<EvolutionStateSnapshot>("/admin/api/evolution/state");
      setEvolutionSnapshot(payload);
    } finally {
      if (!silent) {
        setLoadingEvolution(false);
      }
    }
  }

  async function handleSubmitEvolutionGoal(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const goal = evolutionGoalDraft.trim();
    const commitMessage = evolutionCommitDraft.trim();

    if (!goal) {
      args.setNotice({ type: "error", title: "请先输入 Goal 需求" });
      return;
    }

    setSubmittingEvolutionGoal(true);
    try {
      const payload = await request<{ ok: boolean; goal: EvolutionGoal }>("/admin/api/evolution/goals", {
        method: "POST",
        body: JSON.stringify({
          goal,
          ...(commitMessage ? { commitMessage } : {})
        })
      });
      await loadEvolutionState({ silent: true });
      setEvolutionGoalDraft("");
      args.setNotice({
        type: "success",
        title: "Evolution Goal 已入队",
        text: `${payload.goal.id} (${payload.goal.status})`
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "提交 Evolution Goal 失败", text });
    } finally {
      setSubmittingEvolutionGoal(false);
    }
  }

  async function handleTriggerEvolutionTick(): Promise<void> {
    setTriggeringEvolutionTick(true);
    try {
      await request<{ ok: boolean }>("/admin/api/evolution/tick", {
        method: "POST",
        body: "{}"
      });
      await loadEvolutionState({ silent: true });
      args.setNotice({ type: "success", title: "已触发 Evolution Tick" });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "触发 Evolution Tick 失败", text });
    } finally {
      setTriggeringEvolutionTick(false);
    }
  }

  return {
    evolutionSnapshot,
    loadingEvolution,
    evolutionGoalDraft,
    evolutionCommitDraft,
    submittingEvolutionGoal,
    triggeringEvolutionTick,
    setEvolutionGoalDraft,
    setEvolutionCommitDraft,
    loadEvolutionState,
    handleSubmitEvolutionGoal,
    handleTriggerEvolutionTick
  };
}
