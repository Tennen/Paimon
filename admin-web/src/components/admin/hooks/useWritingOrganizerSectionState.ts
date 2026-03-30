import type { WritingOrganizerSectionProps } from "@/types/admin";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useWritingOrganizerSectionState(): WritingOrganizerSectionProps {
  const state = useAdminStore(useShallow((store) => ({
    writingTopics: store.writingTopics,
    writingSelectedTopicId: store.writingSelectedTopicId,
    writingTopicIdDraft: store.writingTopicIdDraft,
    writingTopicTitleDraft: store.writingTopicTitleDraft,
    writingAppendDraft: store.writingAppendDraft,
    writingTopicDetail: store.writingTopicDetail,
    loadingWritingTopics: store.loadingWritingTopics,
    loadingWritingDetail: store.loadingWritingDetail,
    writingActionState: store.writingActionState,
    writingManualSection: store.writingManualSection,
    writingManualContent: store.writingManualContent,
    handleWritingTopicSelect: store.handleWritingTopicSelect,
    setWritingTopicIdDraft: store.setWritingTopicIdDraft,
    setWritingTopicTitleDraft: store.setWritingTopicTitleDraft,
    setWritingAppendDraft: store.setWritingAppendDraft,
    setWritingManualSection: store.setWritingManualSection,
    setWritingManualContent: store.setWritingManualContent,
    loadWritingTopics: store.loadWritingTopics,
    handleAppendWritingTopic: store.handleAppendWritingTopic,
    handleSummarizeWritingTopic: store.handleSummarizeWritingTopic,
    handleRestoreWritingTopic: store.handleRestoreWritingTopic,
    handleSetWritingTopicState: store.handleSetWritingTopicState
  })));

  return {
    topics: state.writingTopics,
    selectedTopicId: state.writingSelectedTopicId,
    topicIdDraft: state.writingTopicIdDraft,
    topicTitleDraft: state.writingTopicTitleDraft,
    appendDraft: state.writingAppendDraft,
    detail: state.writingTopicDetail,
    loadingTopics: state.loadingWritingTopics,
    loadingDetail: state.loadingWritingDetail,
    actionState: state.writingActionState,
    manualSection: state.writingManualSection,
    manualContent: state.writingManualContent,
    onSelectTopic: state.handleWritingTopicSelect,
    onTopicIdDraftChange: state.setWritingTopicIdDraft,
    onTopicTitleDraftChange: state.setWritingTopicTitleDraft,
    onAppendDraftChange: state.setWritingAppendDraft,
    onManualSectionChange: state.setWritingManualSection,
    onManualContentChange: state.setWritingManualContent,
    onRefresh: () => {
      void state.loadWritingTopics();
    },
    onAppend: () => {
      void state.handleAppendWritingTopic();
    },
    onSummarize: () => {
      void state.handleSummarizeWritingTopic();
    },
    onRestore: () => {
      void state.handleRestoreWritingTopic();
    },
    onSetState: () => {
      void state.handleSetWritingTopicState();
    }
  };
}
