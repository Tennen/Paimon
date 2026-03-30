import { useMemo } from "react";
import type { FormEvent } from "react";
import { buildEvolutionQueueRows } from "@/lib/evolutionQueueRows";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useEvolutionSectionState() {
  const state = useAdminStore(useShallow((store) => ({
    evolutionSnapshot: store.evolutionSnapshot,
    loadingEvolution: store.loadingEvolution,
    evolutionGoalDraft: store.evolutionGoalDraft,
    evolutionCommitDraft: store.evolutionCommitDraft,
    submittingEvolutionGoal: store.submittingEvolutionGoal,
    triggeringEvolutionTick: store.triggeringEvolutionTick,
    codexDraft: store.codexDraft,
    savingCodexConfig: store.savingCodexConfig,
    setEvolutionGoalDraft: store.setEvolutionGoalDraft,
    setEvolutionCommitDraft: store.setEvolutionCommitDraft,
    setCodexDraft: store.setCodexDraft,
    handleSubmitEvolutionGoal: store.handleSubmitEvolutionGoal,
    handleTriggerEvolutionTick: store.handleTriggerEvolutionTick,
    loadEvolutionState: store.loadEvolutionState,
    handleSaveCodexConfig: store.handleSaveCodexConfig
  })));

  const currentEvolutionGoal = useMemo(() => {
    if (!state.evolutionSnapshot?.state.currentGoalId) {
      return null;
    }
    return state.evolutionSnapshot.state.goals.find((goal) => goal.id === state.evolutionSnapshot?.state.currentGoalId) ?? null;
  }, [state.evolutionSnapshot]);

  const evolutionQueueRows = useMemo(() => {
    return buildEvolutionQueueRows({
      goals: state.evolutionSnapshot?.state.goals,
      history: state.evolutionSnapshot?.state.history,
      retryItems: state.evolutionSnapshot?.retryQueue.items
    });
  }, [state.evolutionSnapshot]);

  return {
    evolutionSnapshot: state.evolutionSnapshot,
    currentEvolutionGoal,
    evolutionQueueRows,
    loadingEvolution: state.loadingEvolution,
    evolutionGoalDraft: state.evolutionGoalDraft,
    evolutionCommitDraft: state.evolutionCommitDraft,
    submittingEvolutionGoal: state.submittingEvolutionGoal,
    triggeringEvolutionTick: state.triggeringEvolutionTick,
    codexModelDraft: state.codexDraft.model,
    codexReasoningEffortDraft: state.codexDraft.reasoningEffort,
    savingCodexConfig: state.savingCodexConfig,
    onGoalDraftChange: state.setEvolutionGoalDraft,
    onCommitDraftChange: state.setEvolutionCommitDraft,
    onCodexModelDraftChange: (value: string) => {
      state.setCodexDraft((prev) => ({ ...prev, model: value }));
    },
    onCodexReasoningEffortDraftChange: (value: string) => {
      state.setCodexDraft((prev) => ({ ...prev, reasoningEffort: value }));
    },
    onSubmitGoal: (event: FormEvent<HTMLFormElement>) => {
      void state.handleSubmitEvolutionGoal(event);
    },
    onTriggerTick: () => {
      void state.handleTriggerEvolutionTick();
    },
    onRefresh: () => {
      void state.loadEvolutionState();
    },
    onSaveCodexConfig: () => {
      void state.handleSaveCodexConfig();
    }
  };
}
