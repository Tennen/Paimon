export type WritingTopicStatus = "active" | "archived";

export type WritingMaterialType =
  | "social_post"
  | "web_page"
  | "local_text"
  | "image"
  | "note"
  | "chat_record"
  | "mixed";

export type WritingMaterialInputMode = "url" | "text" | "image" | "mixed";

export type WritingDocumentMode = "knowledge_entry" | "article" | "memo" | "research_note";

export type WritingMaterial = {
  id: string;
  topic_id: string;
  type: WritingMaterialType;
  source: string;
  input_mode: WritingMaterialInputMode;
  raw_text: string;
  clean_text: string;
  assets: string[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type WritingInsight = {
  id: string;
  topic_id: string;
  material_ids: string[];
  summary: string;
  key_points: string[];
  tags: string[];
  entities: string[];
  quality_score: number;
  created_at: string;
};

export type WritingDocument = {
  id: string;
  topic_id: string;
  material_ids: string[];
  insight_id: string;
  mode: WritingDocumentMode;
  title: string;
  path: string;
  version: number;
  created_at: string;
};

export type WritingTopicArtifacts = {
  materialCount: number;
  insightCount: number;
  documentCount: number;
  latestInsight?: WritingInsight;
  latestDocument?: WritingDocument;
};

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
  artifacts?: WritingTopicArtifacts;
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
  materialIds?: string[];
};

export type WritingSummarizeResult = {
  topicId: string;
  meta: WritingTopicMeta;
  state: WritingTopicState;
  backup: WritingTopicState;
  rawLineCount: number;
  generatedAt: string;
  materialCount?: number;
  mode?: WritingDocumentMode;
  insight?: WritingInsight;
  document?: WritingDocument;
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
  | { kind: "summarize"; topicId: string; mode?: WritingDocumentMode }
  | { kind: "restore"; topicId: string }
  | { kind: "set_state"; topicId: string; section: WritingStateSection; content: string };
