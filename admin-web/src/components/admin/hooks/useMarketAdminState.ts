import type {
  LLMProviderStore,
  Notice,
  PushUser,
  SearchEngineStore
} from "@/types/admin";
import { useMarketExecutionState } from "./useMarketExecutionState";
import { useMarketPortfolioState } from "./useMarketPortfolioState";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type UseMarketAdminStateArgs = {
  llmProviderStore: LLMProviderStore | null;
  marketSearchEngineStore: SearchEngineStore | null;
  users: PushUser[];
  loadTasks: () => Promise<void>;
  setNotice: NoticeSetter;
};

export function useMarketAdminState(args: UseMarketAdminStateArgs) {
  const portfolio = useMarketPortfolioState({
    llmProviderStore: args.llmProviderStore,
    marketSearchEngineStore: args.marketSearchEngineStore,
    setNotice: args.setNotice
  });
  const execution = useMarketExecutionState({
    users: args.users,
    loadTasks: args.loadTasks,
    setNotice: args.setNotice
  });

  return {
    ...portfolio,
    ...execution
  };
}
