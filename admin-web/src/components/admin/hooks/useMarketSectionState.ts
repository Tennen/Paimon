import type { MarketSectionProps, MarketPhase } from "@/types/admin";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useMarketSectionState(): MarketSectionProps {
  const state = useAdminStore(useShallow((store) => ({
    marketConfig: store.marketConfig,
    marketPortfolio: store.marketPortfolio,
    marketAnalysisConfig: store.marketAnalysisConfig,
    marketSearchEngines: store.marketSearchEngines,
    defaultMarketSearchEngineId: store.defaultMarketSearchEngineId,
    llmProviders: store.llmProviders,
    defaultLlmProviderId: store.defaultLlmProviderId,
    marketRuns: store.marketRuns,
    savingMarketPortfolio: store.savingMarketPortfolio,
    savingMarketAnalysisConfig: store.savingMarketAnalysisConfig,
    marketFundSaveStates: store.marketFundSaveStates,
    bootstrappingMarketTasks: store.bootstrappingMarketTasks,
    runningMarketOncePhase: store.runningMarketOncePhase,
    enabledUsers: store.enabledUsers,
    marketTaskUserId: store.marketTaskUserId,
    marketMiddayTime: store.marketMiddayTime,
    marketCloseTime: store.marketCloseTime,
    marketBatchCodesInput: store.marketBatchCodesInput,
    importingMarketCodes: store.importingMarketCodes,
    marketSearchInputs: store.marketSearchInputs,
    marketSearchResults: store.marketSearchResults,
    searchingMarketFundIndex: store.searchingMarketFundIndex,
    handleMarketCashChange: store.handleMarketCashChange,
    handleMarketAnalysisEngineChange: store.handleMarketAnalysisEngineChange,
    handleMarketSearchEngineChange: store.handleMarketSearchEngineChange,
    handleMarketFundNewsQuerySuffixChange: store.handleMarketFundNewsQuerySuffixChange,
    handleMarketGptPluginTimeoutMsChange: store.handleMarketGptPluginTimeoutMsChange,
    handleMarketGptPluginFallbackToLocalChange: store.handleMarketGptPluginFallbackToLocalChange,
    handleMarketFundEnabledChange: store.handleMarketFundEnabledChange,
    handleMarketFundMaxAgeDaysChange: store.handleMarketFundMaxAgeDaysChange,
    handleMarketFundFeatureLookbackDaysChange: store.handleMarketFundFeatureLookbackDaysChange,
    handleMarketFundRiskLevelChange: store.handleMarketFundRiskLevelChange,
    handleMarketFundLlmRetryMaxChange: store.handleMarketFundLlmRetryMaxChange,
    setMarketTaskUserId: store.setMarketTaskUserId,
    setMarketMiddayTime: store.setMarketMiddayTime,
    setMarketCloseTime: store.setMarketCloseTime,
    setMarketBatchCodesInput: store.setMarketBatchCodesInput,
    handleAddMarketFund: store.handleAddMarketFund,
    handleRemoveMarketFund: store.handleRemoveMarketFund,
    handleMarketFundChange: store.handleMarketFundChange,
    handleMarketSearchInputChange: store.handleMarketSearchInputChange,
    handleSearchMarketByName: store.handleSearchMarketByName,
    handleApplyMarketSearchResult: store.handleApplyMarketSearchResult,
    handleSaveMarketFund: store.handleSaveMarketFund,
    handleSaveMarketPortfolio: store.handleSaveMarketPortfolio,
    handleSaveMarketAnalysisConfig: store.handleSaveMarketAnalysisConfig,
    handleImportMarketCodes: store.handleImportMarketCodes,
    loadMarketConfig: store.loadMarketConfig,
    loadMarketRuns: store.loadMarketRuns,
    handleBootstrapMarketTasks: store.handleBootstrapMarketTasks,
    handleRunMarketOnce: store.handleRunMarketOnce
  })));

  return {
    marketConfig: state.marketConfig,
    marketPortfolio: state.marketPortfolio,
    marketAnalysisConfig: state.marketAnalysisConfig,
    marketSearchEngines: state.marketSearchEngines,
    defaultMarketSearchEngineId: state.defaultMarketSearchEngineId,
    llmProviders: state.llmProviders,
    defaultLlmProviderId: state.defaultLlmProviderId,
    marketRuns: state.marketRuns,
    savingMarketPortfolio: state.savingMarketPortfolio,
    savingMarketAnalysisConfig: state.savingMarketAnalysisConfig,
    marketFundSaveStates: state.marketFundSaveStates,
    bootstrappingMarketTasks: state.bootstrappingMarketTasks,
    runningMarketOncePhase: state.runningMarketOncePhase,
    enabledUsers: state.enabledUsers,
    marketTaskUserId: state.marketTaskUserId,
    marketMiddayTime: state.marketMiddayTime,
    marketCloseTime: state.marketCloseTime,
    marketBatchCodesInput: state.marketBatchCodesInput,
    importingMarketCodes: state.importingMarketCodes,
    marketSearchInputs: state.marketSearchInputs,
    marketSearchResults: state.marketSearchResults,
    searchingMarketFundIndex: state.searchingMarketFundIndex,
    onCashChange: state.handleMarketCashChange,
    onMarketAnalysisEngineChange: state.handleMarketAnalysisEngineChange,
    onMarketSearchEngineChange: state.handleMarketSearchEngineChange,
    onMarketFundNewsQuerySuffixChange: state.handleMarketFundNewsQuerySuffixChange,
    onMarketGptPluginTimeoutMsChange: state.handleMarketGptPluginTimeoutMsChange,
    onMarketGptPluginFallbackToLocalChange: state.handleMarketGptPluginFallbackToLocalChange,
    onMarketFundEnabledChange: state.handleMarketFundEnabledChange,
    onMarketFundMaxAgeDaysChange: state.handleMarketFundMaxAgeDaysChange,
    onMarketFundFeatureLookbackDaysChange: state.handleMarketFundFeatureLookbackDaysChange,
    onMarketFundRiskLevelChange: state.handleMarketFundRiskLevelChange,
    onMarketFundLlmRetryMaxChange: state.handleMarketFundLlmRetryMaxChange,
    onMarketTaskUserIdChange: state.setMarketTaskUserId,
    onMarketMiddayTimeChange: state.setMarketMiddayTime,
    onMarketCloseTimeChange: state.setMarketCloseTime,
    onMarketBatchCodesInputChange: state.setMarketBatchCodesInput,
    onAddMarketFund: state.handleAddMarketFund,
    onRemoveMarketFund: state.handleRemoveMarketFund,
    onMarketFundChange: state.handleMarketFundChange,
    onMarketSearchInputChange: state.handleMarketSearchInputChange,
    onSearchMarketByName: (index: number) => {
      void state.handleSearchMarketByName(index);
    },
    onApplyMarketSearchResult: state.handleApplyMarketSearchResult,
    onSaveMarketFund: (index: number) => {
      void state.handleSaveMarketFund(index);
    },
    onSaveMarketPortfolio: () => {
      void state.handleSaveMarketPortfolio();
    },
    onSaveMarketAnalysisConfig: () => {
      void state.handleSaveMarketAnalysisConfig();
    },
    onImportMarketCodes: () => {
      void state.handleImportMarketCodes();
    },
    onRefresh: () => {
      void Promise.all([state.loadMarketConfig(), state.loadMarketRuns()]);
    },
    onBootstrapMarketTasks: () => {
      void state.handleBootstrapMarketTasks();
    },
    onRunMarketOnce: (phase: MarketPhase) => {
      void state.handleRunMarketOnce(phase);
    }
  };
}
