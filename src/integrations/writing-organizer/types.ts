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

export type WritingOrganizerIndexStore = {
  version: 1;
  topicIds: string[];
  updatedAt: string;
};

export type WritingAppendResult = {
  topicId: string;
  appendedLines: number;
  latestRawFile: string;
  meta: WritingTopicMeta;
};

export type WritingSummarizeResult = {
  topicId: string;
  meta: WritingTopicMeta;
  state: WritingTopicState;
  backup: WritingTopicState;
  rawLineCount: number;
  generatedAt: string;
};

export type WritingRestoreResult = {
  topicId: string;
  meta: WritingTopicMeta;
  state: WritingTopicState;
};

export type ParsedCommand =
  | { kind: "help" }
  | { kind: "topics" }
  | { kind: "show"; topicId: string }
  | { kind: "append"; topicId: string; content: string; title?: string }
  | { kind: "summarize"; topicId: string }
  | { kind: "restore"; topicId: string }
  | { kind: "set_state"; topicId: string; section: WritingStateSection; content: string };
