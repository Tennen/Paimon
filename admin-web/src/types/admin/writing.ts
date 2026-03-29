import type { DataStoreDescriptor } from "./common";

export type WritingTopicStatus = "active" | "archived";

export type WritingTopicMeta = {
  topicId: string;
  title: string;
  status: WritingTopicStatus;
  rawFileCount: number;
  rawLineCount: number;
  lastSummarizedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WritingTopicState = {
  summary: string;
  outline: string;
  draft: string;
};

export type WritingStateSection = keyof WritingTopicState;

export type WritingTopicRawFile = {
  name: string;
  lineCount: number;
  content: string;
};

export type WritingTopicDetail = {
  meta: WritingTopicMeta;
  state: WritingTopicState;
  backup: WritingTopicState;
  rawFiles: WritingTopicRawFile[];
};

export type WritingTopicsPayload = {
  topics: WritingTopicMeta[];
  indexStore: DataStoreDescriptor;
};

export type WritingOrganizerSectionProps = {
  topics: WritingTopicMeta[];
  selectedTopicId: string;
  topicIdDraft: string;
  topicTitleDraft: string;
  appendDraft: string;
  detail: WritingTopicDetail | null;
  loadingTopics: boolean;
  loadingDetail: boolean;
  actionState: "append" | "summarize" | "restore" | "set" | null;
  manualSection: WritingStateSection;
  manualContent: string;
  onSelectTopic: (topicId: string) => void;
  onTopicIdDraftChange: (value: string) => void;
  onTopicTitleDraftChange: (value: string) => void;
  onAppendDraftChange: (value: string) => void;
  onManualSectionChange: (value: WritingStateSection) => void;
  onManualContentChange: (value: string) => void;
  onRefresh: () => void;
  onAppend: () => void;
  onSummarize: () => void;
  onRestore: () => void;
  onSetState: () => void;
};
