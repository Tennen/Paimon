import type { MainConversationMode } from "@/types/admin";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useConversationBenchmarkSectionState() {
  const state = useAdminStore(useShallow((store) => ({
    config: store.config,
    runningBenchmark: store.runningConversationBenchmark,
    benchmarkResult: store.conversationBenchmarkResult,
    runConversationBenchmark: store.runConversationBenchmark,
    loadConfig: store.loadConfig
  })));

  return {
    config: state.config,
    runningBenchmark: state.runningBenchmark,
    benchmarkResult: state.benchmarkResult,
    onRunBenchmark: (input: { turns: string[]; repeatCount: number; modes: MainConversationMode[] }) => {
      void state.runConversationBenchmark(input);
    },
    onRefreshConfig: () => {
      void state.loadConfig();
    }
  };
}
