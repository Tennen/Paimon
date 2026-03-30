import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useTopicSummarySectionState() {
  const state = useAdminStore(useShallow((store) => ({
    topicSummaryProfiles: store.topicSummaryProfiles,
    topicSummaryActiveProfileId: store.topicSummaryActiveProfileId,
    topicSummarySelectedProfileId: store.topicSummarySelectedProfileId,
    topicSummaryConfig: store.topicSummaryConfig,
    llmProviders: store.llmProviders,
    defaultLlmProviderId: store.defaultLlmProviderId,
    topicSummaryState: store.topicSummaryState,
    savingTopicSummaryProfileAction: store.savingTopicSummaryProfileAction,
    savingTopicSummaryConfig: store.savingTopicSummaryConfig,
    clearingTopicSummaryState: store.clearingTopicSummaryState,
    handleTopicProfileSelect: store.handleTopicProfileSelect,
    handleAddTopicProfile: store.handleAddTopicProfile,
    handleRenameTopicProfile: store.handleRenameTopicProfile,
    handleUseTopicProfile: store.handleUseTopicProfile,
    handleDeleteTopicProfile: store.handleDeleteTopicProfile,
    handleTopicSummaryEngineChange: store.handleTopicSummaryEngineChange,
    handleTopicDefaultLanguageChange: store.handleTopicDefaultLanguageChange,
    handleTopicSourceChange: store.handleTopicSourceChange,
    handleAddTopicSource: store.handleAddTopicSource,
    handleRemoveTopicSource: store.handleRemoveTopicSource,
    handleSaveTopicSummaryConfig: store.handleSaveTopicSummaryConfig,
    loadTopicSummaryConfig: store.loadTopicSummaryConfig,
    handleClearTopicSummaryState: store.handleClearTopicSummaryState
  })));

  return {
    topicSummaryProfiles: state.topicSummaryProfiles,
    topicSummaryActiveProfileId: state.topicSummaryActiveProfileId,
    topicSummarySelectedProfileId: state.topicSummarySelectedProfileId,
    topicSummaryConfig: state.topicSummaryConfig,
    llmProviders: state.llmProviders,
    defaultLlmProviderId: state.defaultLlmProviderId,
    topicSummaryState: state.topicSummaryState,
    savingTopicSummaryProfileAction: state.savingTopicSummaryProfileAction,
    savingTopicSummaryConfig: state.savingTopicSummaryConfig,
    clearingTopicSummaryState: state.clearingTopicSummaryState,
    onSelectProfile: state.handleTopicProfileSelect,
    onAddProfile: () => {
      void state.handleAddTopicProfile();
    },
    onRenameProfile: () => {
      void state.handleRenameTopicProfile();
    },
    onUseProfile: () => {
      void state.handleUseTopicProfile();
    },
    onDeleteProfile: () => {
      void state.handleDeleteTopicProfile();
    },
    onSummaryEngineChange: state.handleTopicSummaryEngineChange,
    onDefaultLanguageChange: state.handleTopicDefaultLanguageChange,
    onSourceChange: state.handleTopicSourceChange,
    onAddSource: state.handleAddTopicSource,
    onRemoveSource: state.handleRemoveTopicSource,
    onSaveConfig: () => {
      void state.handleSaveTopicSummaryConfig();
    },
    onRefresh: () => {
      void state.loadTopicSummaryConfig();
    },
    onClearSentLog: () => {
      void state.handleClearTopicSummaryState();
    }
  };
}
