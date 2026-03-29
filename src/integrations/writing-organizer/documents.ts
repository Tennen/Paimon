import path from "path";
import { resolveDataPath } from "../../storage/persistence";
import { buildSummarizedState } from "./runtime";
import { normalizeMultilineText } from "./shared";
import {
  WritingDocument,
  WritingDocumentMode,
  WritingInsight,
  WritingMaterial,
  WritingTopicArtifacts,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicState
} from "./types";
import {
  asRecord,
  compareArtifactAsc,
  createArtifactId,
  ensureDir,
  listKnowledgeFiles,
  normalizeDocumentMode,
  normalizeIdentifier,
  normalizePath,
  normalizeStringArray,
  normalizeTimestamp,
  normalizeScore,
  previewInline,
  readJsonFile,
  resolveAbsolutePath,
  resolveKnowledgeFilePath,
  resolveTopicKnowledgeRoot,
  resolveTopicRoot,
  safeDate,
  safeVersion,
  takeFirstNonEmptyLines,
  writeJsonFile,
  writeTextFile,
  DOCUMENT_META_SUFFIX,
  DOCUMENTS_DIR_NAME
} from "./artifactHelpers";
import { loadInsights, loadMaterials } from "./materials";
import { getTopicDetail, getTopicMeta, readTopicBackup, readTopicRawLines, readTopicState, updateTopicMeta, writeTopicState } from "./storage";

export function composeDocument(input: {
  topicId: string;
  title: string;
  mode: WritingDocumentMode;
  version: number;
  generatedAt: string;
  materials: WritingMaterial[];
  insight: WritingInsight;
  baselineDraft: string;
}): {
  document: WritingDocument;
  markdown: string;
} {
  const documentId = createArtifactId("doc", input.generatedAt);
  const fileStem = `${documentId}_v${String(input.version).padStart(3, "0")}_${input.mode}`;
  const markdownPath = resolveKnowledgeFilePath(input.topicId, DOCUMENTS_DIR_NAME, input.generatedAt, `${fileStem}.md`);
  const relativePath = normalizePath(path.relative(resolveTopicRoot(input.topicId), markdownPath));

  const document: WritingDocument = {
    id: documentId,
    topic_id: input.topicId,
    material_ids: input.insight.material_ids,
    insight_id: input.insight.id,
    mode: input.mode,
    title: input.title,
    path: relativePath,
    version: input.version,
    created_at: input.generatedAt
  };

  const markdown = buildDocumentMarkdown({
    title: input.title,
    generatedAt: input.generatedAt,
    mode: input.mode,
    document,
    insight: input.insight,
    materials: input.materials,
    baselineDraft: input.baselineDraft
  });

  return {
    document,
    markdown
  };
}

export function buildStateFromArtifacts(input: {
  title: string;
  mode: WritingDocumentMode;
  generatedAt: string;
  insight: WritingInsight;
  document: WritingDocument;
  markdown: string;
}): WritingTopicState {
  const summaryLines: string[] = [
    `# ${input.title}`,
    `- mode: ${input.mode}`,
    `- document: ${input.document.id} (v${input.document.version})`,
    `- generatedAt: ${input.generatedAt}`,
    `- qualityScore: ${input.insight.quality_score.toFixed(2)}`,
    "",
    "## Insight Summary",
    input.insight.summary || "(empty)",
    "",
    "## Tags",
    ...(input.insight.tags.length > 0 ? input.insight.tags.map((tag) => `- ${tag}`) : ["- (empty)"]),
    "",
    "## Entities",
    ...(input.insight.entities.length > 0 ? input.insight.entities.map((entity) => `- ${entity}`) : ["- (empty)"])
  ];

  const outlineLines: string[] = [
    `# ${input.title} 提纲`,
    "1. 问题与背景",
    `   - ${input.insight.summary || "补充背景信息"}`,
    "2. 关键观察",
    ...(input.insight.key_points.length > 0
      ? input.insight.key_points.slice(0, 4).map((point) => `   - ${point}`)
      : ["   - 补充关键观察"]),
    "3. 建议动作",
    `   - 基于 mode=${input.mode} 继续扩写文档正文`,
    "4. 溯源",
    `   - material_ids: ${input.insight.material_ids.join(", ") || "(none)"}`
  ];

  return {
    summary: summaryLines.join("\n"),
    outline: outlineLines.join("\n"),
    draft: input.markdown
  };
}

export function collectTopicArtifacts(topicId: string): WritingTopicArtifacts {
  const materials = loadMaterials(topicId);
  const insights = loadInsights(topicId);
  const documents = loadDocuments(topicId);

  const latestInsight = insights.length > 0 ? insights[insights.length - 1] : undefined;
  const latestDocument = documents.length > 0 ? documents[documents.length - 1] : undefined;

  return {
    materialCount: materials.length,
    insightCount: insights.length,
    documentCount: documents.length,
    ...(latestInsight ? { latestInsight } : {}),
    ...(latestDocument ? { latestDocument } : {})
  };
}

export function persistDocument(document: WritingDocument, markdown: string): void {
  const absoluteMarkdownPath = resolveAbsolutePath(document.topic_id, document.path);
  writeTextFile(absoluteMarkdownPath, markdown);

  const metadataPath = absoluteMarkdownPath.replace(/\.md$/i, DOCUMENT_META_SUFFIX);
  writeJsonFile(metadataPath, document);
}

export function resolveNextDocumentVersion(topicId: string): number {
  const existing = loadDocuments(topicId);
  const latest = existing.reduce((maxVersion, document) => Math.max(maxVersion, safeVersion(document.version)), 0);
  return latest + 1;
}

export function resolveDocumentMode(rawMode: WritingDocumentMode | undefined, title: string): WritingDocumentMode {
  if (rawMode) {
    return rawMode;
  }

  const normalized = title.trim().toLowerCase();
  if (normalized.includes("research") || normalized.includes("研究")) {
    return "research_note";
  }
  if (normalized.includes("memo") || normalized.includes("备忘")) {
    return "memo";
  }
  if (normalized.includes("article") || normalized.includes("文章")) {
    return "article";
  }
  return "knowledge_entry";
}

export function loadDocuments(topicId: string): WritingDocument[] {
  const files = listKnowledgeFiles(topicId, DOCUMENTS_DIR_NAME, DOCUMENT_META_SUFFIX);
  const entries: WritingDocument[] = [];

  for (const filePath of files) {
    const parsed = readJsonFile(filePath);
    const normalized = normalizeDocument(parsed, topicId);
    if (normalized) {
      entries.push(normalized);
    }
  }

  return entries.sort(compareArtifactAsc);
}

function buildDocumentMarkdown(input: {
  title: string;
  generatedAt: string;
  mode: WritingDocumentMode;
  document: WritingDocument;
  insight: WritingInsight;
  materials: WritingMaterial[];
  baselineDraft: string;
}): string {
  const keyPoints = input.insight.key_points.length > 0
    ? input.insight.key_points.map((point, index) => `${index + 1}. ${point}`)
    : ["1. (empty)"];

  const materialRefs = input.materials.length > 0
    ? input.materials.map((material) => {
      const snippet = previewInline(material.clean_text || material.raw_text, 72);
      return `- ${material.id} | type=${material.type} | source=${material.source} | ${snippet}`;
    })
    : ["- (empty)"];

  const tags = input.insight.tags.length > 0
    ? input.insight.tags.map((tag) => `- ${tag}`)
    : ["- (empty)"];

  const entities = input.insight.entities.length > 0
    ? input.insight.entities.map((entity) => `- ${entity}`)
    : ["- (empty)"];

  const baseline = takeFirstNonEmptyLines(input.baselineDraft, 20);

  return [
    "---",
    `id: ${input.document.id}`,
    `topic_id: ${input.document.topic_id}`,
    `mode: ${input.mode}`,
    `version: ${input.document.version}`,
    `created_at: ${input.generatedAt}`,
    `insight_id: ${input.insight.id}`,
    "material_ids:",
    ...input.insight.material_ids.map((materialId) => `  - ${materialId}`),
    "---",
    "",
    `# ${input.title}`,
    "",
    "## 摘要",
    input.insight.summary || "(empty)",
    "",
    "## 关键要点",
    ...keyPoints,
    "",
    "## 标签",
    ...tags,
    "",
    "## 实体",
    ...entities,
    "",
    "## 初稿",
    ...(baseline.length > 0 ? baseline : ["(empty)"]),
    "",
    "## 材料溯源",
    ...materialRefs
  ].join("\n");
}

function normalizeDocument(input: unknown, fallbackTopicId: string): WritingDocument | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const createdAt = normalizeTimestamp(source.created_at, new Date(0).toISOString());
  return {
    id: normalizeIdentifier(String(source.id ?? ""), "doc", createdAt),
    topic_id: String(source.topic_id ?? fallbackTopicId).trim() || fallbackTopicId,
    material_ids: Array.isArray(source.material_ids)
      ? source.material_ids.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
      : [],
    insight_id: String(source.insight_id ?? "").trim(),
    mode: normalizeDocumentMode(source.mode),
    title: String(source.title ?? "").trim() || fallbackTopicId,
    path: normalizePath(String(source.path ?? "")),
    version: safeVersion(source.version),
    created_at: createdAt
  };
}
