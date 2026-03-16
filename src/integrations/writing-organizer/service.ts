import fs from "fs";
import path from "path";
import { resolveDataPath } from "../../storage/persistence";
import { WRITING_DIRECT_COMMANDS } from "./defaults";
import { parseCommand } from "./commands";
import {
  buildHelpText,
  formatAppendResult,
  formatRestoreResult,
  formatSetStateResult,
  formatSummarizeResult,
  formatTopicDetail,
  formatTopicList
} from "./formatters";
import { buildSummarizedState } from "./runtime";
import { normalizeMultilineText } from "./shared";
import {
  appendTopicRawContent,
  backupTopicState,
  ensureWritingOrganizerStorage,
  getTopicMeta,
  getTopicDetail,
  listTopicMeta,
  readTopicRawLines,
  readTopicState,
  restoreTopicStateFromBackup,
  updateTopicMeta,
  writeTopicState,
  writeTopicStateSection
} from "./storage";
import {
  WritingAppendResult,
  WritingDocument,
  WritingDocumentMode,
  WritingInsight,
  WritingMaterial,
  WritingMaterialInputMode,
  WritingMaterialType,
  WritingRestoreResult,
  WritingStateSection,
  WritingSummarizeResult,
  WritingTopicArtifacts,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicState
} from "./types";

const KNOWLEDGE_DIR_NAME = "knowledge";
const MATERIALS_DIR_NAME = "materials";
const INSIGHTS_DIR_NAME = "insights";
const DOCUMENTS_DIR_NAME = "documents";
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
const DOCUMENT_META_SUFFIX = ".meta.json";

export const directCommands = WRITING_DIRECT_COMMANDS;

export type {
  WritingTopicMeta,
  WritingTopicState,
  WritingTopicDetail,
  WritingAppendResult,
  WritingSummarizeResult,
  WritingRestoreResult,
  WritingStateSection,
  WritingMaterial,
  WritingInsight,
  WritingDocument,
  WritingDocumentMode
} from "./types";

export async function execute(input: string): Promise<{ text: string; result?: unknown }> {
  try {
    ensureWritingOrganizerStorage();
    const command = parseCommand(input);

    switch (command.kind) {
      case "help":
        return { text: buildHelpText() };
      case "topics": {
        const topics = listWritingTopics();
        return {
          text: formatTopicList(topics),
          result: { topics }
        };
      }
      case "show": {
        const detail = showWritingTopic(command.topicId);
        return {
          text: formatTopicDetail(detail),
          result: detail
        };
      }
      case "append": {
        const result = appendWritingTopic(command.topicId, command.content, command.title);
        return {
          text: formatAppendResult(result),
          result
        };
      }
      case "summarize": {
        const result = summarizeWritingTopic(command.topicId, command.mode);
        return {
          text: formatSummarizeResult(result),
          result
        };
      }
      case "restore": {
        const result = restoreWritingTopic(command.topicId);
        return {
          text: formatRestoreResult(result),
          result
        };
      }
      case "set_state": {
        const nextState = setWritingTopicState(command.topicId, command.section, command.content);
        return {
          text: formatSetStateResult(command.topicId, command.section, nextState),
          result: {
            topicId: command.topicId,
            section: command.section,
            state: nextState
          }
        };
      }
      default:
        return { text: buildHelpText() };
    }
  } catch (error) {
    return {
      text: `Writing Organizer 执行失败: ${(error as Error).message ?? "unknown error"}`
    };
  }
}

export function listWritingTopics(): WritingTopicMeta[] {
  ensureWritingOrganizerStorage();
  return listTopicMeta();
}

export function showWritingTopic(topicId: string): WritingTopicDetail {
  ensureWritingOrganizerStorage();
  const detail = getTopicDetail(topicId);
  const artifacts = collectTopicArtifacts(detail.meta.topicId);
  return {
    ...detail,
    artifacts
  };
}

export function appendWritingTopic(topicId: string, content: string, title?: string): WritingAppendResult {
  ensureWritingOrganizerStorage();
  const appendResult = appendTopicRawContent(topicId, content, title);

  const material = ingestMaterial({
    topicId: appendResult.topicId,
    content,
    title,
    createdAt: new Date().toISOString()
  });

  persistMaterial(material);

  return {
    ...appendResult,
    materialIds: [material.id]
  };
}

export function summarizeWritingTopic(topicId: string, mode?: WritingDocumentMode): WritingSummarizeResult {
  ensureWritingOrganizerStorage();

  const rawLines = readTopicRawLines(topicId);
  if (rawLines.length === 0) {
    throw new Error("topic 没有可整理的 raw 内容，请先 append");
  }

  const metaBefore = getTopicMeta(topicId);
  const previousState = readTopicState(topicId);
  const backup = backupTopicState(topicId);
  const generatedAt = new Date().toISOString();

  const materials = ensureMaterialsForSummarize(metaBefore.topicId, rawLines, metaBefore.title, generatedAt);
  const insight = extractInsight({
    topicId: metaBefore.topicId,
    materials,
    generatedAt
  });
  persistInsight(insight);

  const selectedMode = resolveDocumentMode(mode, metaBefore.title);
  const nextVersion = resolveNextDocumentVersion(metaBefore.topicId);

  const baselineState = buildSummarizedState({
    meta: metaBefore,
    rawLines,
    previousState,
    generatedAt
  });

  const composed = composeDocument({
    topicId: metaBefore.topicId,
    title: metaBefore.title,
    mode: selectedMode,
    version: nextVersion,
    generatedAt,
    materials,
    insight,
    baselineDraft: baselineState.draft
  });
  persistDocument(composed.document, composed.markdown);

  const nextState = buildStateFromArtifacts({
    title: metaBefore.title,
    mode: selectedMode,
    generatedAt,
    insight,
    document: composed.document,
    markdown: composed.markdown
  });

  const state = writeTopicState(metaBefore.topicId, nextState);
  const meta = updateTopicMeta(metaBefore.topicId, { lastSummarizedAt: generatedAt });

  return {
    topicId: meta.topicId,
    meta,
    state,
    backup,
    rawLineCount: rawLines.length,
    generatedAt,
    materialCount: materials.length,
    mode: selectedMode,
    insight,
    document: composed.document
  };
}

export function restoreWritingTopic(topicId: string): WritingRestoreResult {
  ensureWritingOrganizerStorage();
  const state = restoreTopicStateFromBackup(topicId);
  const meta = updateTopicMeta(topicId);
  return {
    topicId: meta.topicId,
    meta,
    state
  };
}

export function setWritingTopicState(topicId: string, section: WritingStateSection, content: string): WritingTopicState {
  ensureWritingOrganizerStorage();
  const state = writeTopicStateSection(topicId, section, content);
  updateTopicMeta(topicId);
  return state;
}

function ingestMaterial(input: {
  topicId: string;
  content: string;
  title?: string;
  createdAt: string;
}): WritingMaterial {
  const normalizedRaw = normalizeMultilineText(input.content);
  const urls = extractUrls(normalizedRaw);
  const inputMode = inferInputMode(normalizedRaw, urls);
  const source = inferSource(normalizedRaw, urls);
  const type = inferMaterialType(inputMode, source, normalizedRaw);

  return {
    id: createArtifactId("mat", input.createdAt),
    topic_id: input.topicId,
    type,
    source,
    input_mode: inputMode,
    raw_text: normalizedRaw,
    clean_text: normalizeCleanText(normalizedRaw),
    assets: [],
    metadata: {
      ingest_channel: "writing.append",
      ...(input.title ? { title: input.title } : {}),
      ...(urls.length > 0 ? { urls } : {})
    },
    created_at: input.createdAt
  };
}

function ensureMaterialsForSummarize(
  topicId: string,
  rawLines: string[],
  title: string,
  generatedAt: string
): WritingMaterial[] {
  const fromStore = loadMaterials(topicId);
  if (fromStore.length > 0) {
    return fromStore;
  }

  const fallback = ingestMaterial({
    topicId,
    content: rawLines.join("\n"),
    title,
    createdAt: generatedAt
  });
  persistMaterial(fallback);
  return [fallback];
}

function extractInsight(input: {
  topicId: string;
  materials: WritingMaterial[];
  generatedAt: string;
}): WritingInsight {
  const textUnits = input.materials.flatMap((material) => splitTextUnits(material.clean_text || material.raw_text));
  const keyPoints = pickKeyPoints(textUnits, 8);
  const summary = buildInsightSummary(keyPoints, input.materials.length);
  const tags = extractTags(input.materials, keyPoints);
  const entities = extractEntities(input.materials, keyPoints, tags);
  const qualityScore = scoreQuality(input.materials, keyPoints);

  return {
    id: createArtifactId("ins", input.generatedAt),
    topic_id: input.topicId,
    material_ids: input.materials.map((material) => material.id),
    summary,
    key_points: keyPoints,
    tags,
    entities,
    quality_score: qualityScore,
    created_at: input.generatedAt
  };
}

function composeDocument(input: {
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

function buildStateFromArtifacts(input: {
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

function collectTopicArtifacts(topicId: string): WritingTopicArtifacts {
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

function persistMaterial(material: WritingMaterial): void {
  const filePath = resolveKnowledgeFilePath(
    material.topic_id,
    MATERIALS_DIR_NAME,
    material.created_at,
    `${material.id}.json`
  );
  writeJsonFile(filePath, material);
}

function persistInsight(insight: WritingInsight): void {
  const filePath = resolveKnowledgeFilePath(
    insight.topic_id,
    INSIGHTS_DIR_NAME,
    insight.created_at,
    `${insight.id}.json`
  );
  writeJsonFile(filePath, insight);
}

function persistDocument(document: WritingDocument, markdown: string): void {
  const absoluteMarkdownPath = resolveAbsolutePath(document.topic_id, document.path);
  writeTextFile(absoluteMarkdownPath, markdown);

  const metadataPath = absoluteMarkdownPath.replace(/\.md$/i, DOCUMENT_META_SUFFIX);
  writeJsonFile(metadataPath, document);
}

function resolveNextDocumentVersion(topicId: string): number {
  const existing = loadDocuments(topicId);
  const latest = existing.reduce((maxVersion, document) => Math.max(maxVersion, safeVersion(document.version)), 0);
  return latest + 1;
}

function resolveDocumentMode(rawMode: WritingDocumentMode | undefined, title: string): WritingDocumentMode {
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

function loadMaterials(topicId: string): WritingMaterial[] {
  const files = listKnowledgeFiles(topicId, MATERIALS_DIR_NAME, ".json", (fileName) => !fileName.endsWith(DOCUMENT_META_SUFFIX));
  const entries: WritingMaterial[] = [];

  for (const filePath of files) {
    const parsed = readJsonFile(filePath);
    const normalized = normalizeMaterial(parsed, topicId);
    if (normalized) {
      entries.push(normalized);
    }
  }

  return entries.sort(compareArtifactAsc);
}

function loadInsights(topicId: string): WritingInsight[] {
  const files = listKnowledgeFiles(topicId, INSIGHTS_DIR_NAME, ".json");
  const entries: WritingInsight[] = [];

  for (const filePath of files) {
    const parsed = readJsonFile(filePath);
    const normalized = normalizeInsight(parsed, topicId);
    if (normalized) {
      entries.push(normalized);
    }
  }

  return entries.sort(compareArtifactAsc);
}

function loadDocuments(topicId: string): WritingDocument[] {
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

function normalizeMaterial(input: unknown, fallbackTopicId: string): WritingMaterial | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const createdAt = normalizeTimestamp(source.created_at, new Date(0).toISOString());
  const rawText = normalizeMultilineText(String(source.raw_text ?? ""));
  const cleanText = normalizeMultilineText(String(source.clean_text ?? rawText));

  return {
    id: normalizeIdentifier(String(source.id ?? ""), "mat", createdAt),
    topic_id: String(source.topic_id ?? fallbackTopicId).trim() || fallbackTopicId,
    type: normalizeMaterialType(source.type),
    source: String(source.source ?? "manual").trim() || "manual",
    input_mode: normalizeInputMode(source.input_mode),
    raw_text: rawText,
    clean_text: cleanText,
    assets: Array.isArray(source.assets)
      ? source.assets.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
      : [],
    metadata: asRecord(source.metadata) ?? {},
    created_at: createdAt
  };
}

function normalizeInsight(input: unknown, fallbackTopicId: string): WritingInsight | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const createdAt = normalizeTimestamp(source.created_at, new Date(0).toISOString());

  return {
    id: normalizeIdentifier(String(source.id ?? ""), "ins", createdAt),
    topic_id: String(source.topic_id ?? fallbackTopicId).trim() || fallbackTopicId,
    material_ids: Array.isArray(source.material_ids)
      ? source.material_ids.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
      : [],
    summary: normalizeMultilineText(String(source.summary ?? "")),
    key_points: normalizeStringArray(source.key_points),
    tags: normalizeStringArray(source.tags),
    entities: normalizeStringArray(source.entities),
    quality_score: normalizeScore(source.quality_score),
    created_at: createdAt
  };
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

function extractUrls(text: string): string[] {
  const matched = text.match(createUrlPattern());
  if (!matched) {
    return [];
  }
  return Array.from(new Set(matched.map((item) => item.trim()).filter((item) => item.length > 0)));
}

function inferInputMode(text: string, urls: string[]): WritingMaterialInputMode {
  const hasUrl = urls.length > 0;
  const hasImageMarker = /!\[[^\]]*\]\([^)]+\)/.test(text) || IMAGE_EXT_PATTERN.test(text);
  const nonUrlText = text.replace(createUrlPattern(), " ").trim();
  const hasText = nonUrlText.length > 0;

  if ((hasUrl && hasImageMarker) || (hasImageMarker && hasText)) {
    return "mixed";
  }
  if (hasImageMarker) {
    return "image";
  }
  if (hasUrl && hasText) {
    return "mixed";
  }
  if (hasUrl) {
    return "url";
  }
  return "text";
}

function inferSource(text: string, urls: string[]): string {
  const firstUrl = urls[0];
  if (firstUrl) {
    try {
      const hostname = new URL(firstUrl).hostname.replace(/^www\./i, "").toLowerCase();
      if (hostname.includes("xiaohongshu")) {
        return "xiaohongshu";
      }
      if (hostname === "x.com" || hostname.includes("twitter")) {
        return "x";
      }
      if (hostname.includes("weibo")) {
        return "weibo";
      }
      return hostname;
    } catch {
      return "url";
    }
  }

  if (/^\s*(user|assistant|系统|我|你)\s*[:：]/im.test(text)) {
    return "chat";
  }
  return "manual";
}

function inferMaterialType(inputMode: WritingMaterialInputMode, source: string, text: string): WritingMaterialType {
  if (source === "xiaohongshu" || source === "x" || source === "weibo") {
    return "social_post";
  }

  if (inputMode === "image") {
    return "image";
  }

  if (inputMode === "url") {
    return "web_page";
  }

  if (/^\s*(user|assistant|系统|我|你)\s*[:：]/im.test(text) || source === "chat") {
    return "chat_record";
  }

  if (inputMode === "mixed") {
    return "mixed";
  }

  return "local_text";
}

function normalizeCleanText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function splitTextUnits(text: string): string[] {
  const normalized = normalizeMultilineText(text);
  if (!normalized) {
    return [];
  }

  const units: string[] = [];
  const lines = normalized.split("\n");
  for (const line of lines) {
    const sentenceParts = line
      .split(/[。！？!?]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (sentenceParts.length === 0) {
      units.push(line.trim());
      continue;
    }

    units.push(...sentenceParts);
  }

  return units
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0);
}

function pickKeyPoints(units: string[], limit: number): string[] {
  type Candidate = {
    text: string;
    normalized: string;
    count: number;
    firstIndex: number;
    lengthScore: number;
  };

  const map = new Map<string, Candidate>();

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const normalized = unit
      .toLowerCase()
      .replace(/[\s,.;:!?，。；：！？、]/g, "")
      .trim();

    if (!normalized) {
      continue;
    }

    const existing = map.get(normalized);
    if (existing) {
      existing.count += 1;
      continue;
    }

    map.set(normalized, {
      text: unit,
      normalized,
      count: 1,
      firstIndex: index,
      lengthScore: Math.min(180, unit.length)
    });
  }

  return Array.from(map.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (right.lengthScore !== left.lengthScore) {
        return right.lengthScore - left.lengthScore;
      }
      return left.firstIndex - right.firstIndex;
    })
    .slice(0, Math.max(1, limit))
    .map((candidate) => candidate.text);
}

function buildInsightSummary(keyPoints: string[], materialCount: number): string {
  if (keyPoints.length === 0) {
    return "暂无可提取的结构化结论。";
  }

  const top = keyPoints.slice(0, 3).join("；");
  return `基于 ${materialCount} 份材料提炼：${top}`;
}

function extractTags(materials: WritingMaterial[], keyPoints: string[]): string[] {
  const directTags = new Set<string>();

  for (const material of materials) {
    const raw = `${material.raw_text}\n${material.clean_text}`;
    for (const matched of raw.matchAll(/#([a-zA-Z0-9_\u4e00-\u9fff-]{2,30})/g)) {
      const tag = matched[1].trim().toLowerCase();
      if (tag) {
        directTags.add(tag);
      }
    }
  }

  if (directTags.size >= 4) {
    return Array.from(directTags).slice(0, 6);
  }

  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "you",
    "are",
    "was",
    "were",
    "about",
    "我们",
    "你们",
    "他们",
    "一个",
    "一种",
    "进行",
    "以及",
    "然后",
    "如果",
    "但是",
    "因为"
  ]);

  const frequencies = new Map<string, number>();
  const corpus = keyPoints.join("\n");

  for (const token of corpus.match(/[a-zA-Z]{3,}|[\u4e00-\u9fff]{2,6}/g) ?? []) {
    const normalized = token.trim().toLowerCase();
    if (!normalized || stopWords.has(normalized)) {
      continue;
    }

    frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1);
  }

  const fallback = Array.from(frequencies.entries())
    .sort((left, right) => right[1] - left[1])
    .map((entry) => entry[0])
    .slice(0, 6);

  return Array.from(new Set([...directTags, ...fallback])).slice(0, 6);
}

function extractEntities(materials: WritingMaterial[], keyPoints: string[], tags: string[]): string[] {
  const entities = new Set<string>();

  for (const material of materials) {
    const urls = extractUrls(`${material.raw_text}\n${material.clean_text}`);
    for (const url of urls) {
      try {
        entities.add(new URL(url).hostname.replace(/^www\./i, ""));
      } catch {
        entities.add(url);
      }
    }
  }

  for (const token of keyPoints.join("\n").match(/[A-Z][A-Za-z0-9-]{2,}|[\u4e00-\u9fff]{2,8}/g) ?? []) {
    const normalized = token.trim();
    if (normalized.length >= 2) {
      entities.add(normalized);
    }
    if (entities.size >= 10) {
      break;
    }
  }

  if (entities.size < 4) {
    for (const tag of tags) {
      entities.add(tag);
      if (entities.size >= 6) {
        break;
      }
    }
  }

  return Array.from(entities).slice(0, 10);
}

function scoreQuality(materials: WritingMaterial[], keyPoints: string[]): number {
  const totalChars = materials.reduce((count, material) => count + (material.clean_text || material.raw_text).length, 0);
  const uniqueSources = new Set(materials.map((material) => material.source)).size;

  const richness = Math.min(1, totalChars / 1500);
  const structure = Math.min(1, keyPoints.length / 6);
  const diversity = Math.min(1, uniqueSources / 3);

  const score = richness * 0.45 + structure * 0.4 + diversity * 0.15;
  return Number(Math.max(0.1, Math.min(1, score)).toFixed(2));
}

function resolveKnowledgeFilePath(topicId: string, section: string, createdAt: string, fileName: string): string {
  const date = safeDate(createdAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dir = path.join(resolveTopicKnowledgeRoot(topicId), section, year, month);
  ensureDir(dir);
  return path.join(dir, fileName);
}

function listKnowledgeFiles(
  topicId: string,
  section: string,
  fileSuffix: string,
  filter?: (fileName: string) => boolean
): string[] {
  const targetDir = path.join(resolveTopicKnowledgeRoot(topicId), section);
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const result: string[] = [];
  const queue: string[] = [targetDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(fileSuffix)) {
        continue;
      }

      if (filter && !filter(entry.name)) {
        continue;
      }

      result.push(absolutePath);
    }
  }

  return result.sort();
}

function createArtifactId(prefix: "mat" | "ins" | "doc", timestamp: string): string {
  const date = safeDate(timestamp);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  const millis = String(date.getUTCMilliseconds()).padStart(3, "0");
  const random = Math.random().toString(36).slice(2, 6);

  return `${prefix}_${year}${month}${day}_${hour}${minute}${second}${millis}_${random}`;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function writeTextFile(filePath: string, payload: string): void {
  ensureDir(path.dirname(filePath));
  const normalized = normalizeMultilineText(payload);
  fs.writeFileSync(filePath, normalized ? `${normalized}\n` : "", "utf-8");
}

function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function resolveTopicRoot(topicId: string): string {
  return resolveDataPath("writing", "topics", topicId);
}

function resolveTopicKnowledgeRoot(topicId: string): string {
  return path.join(resolveTopicRoot(topicId), KNOWLEDGE_DIR_NAME);
}

function resolveAbsolutePath(topicId: string, relativePath: string): string {
  return path.join(resolveTopicRoot(topicId), relativePath);
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function previewInline(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty)";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(8, maxLength)).trim()}...`;
}

function takeFirstNonEmptyLines(text: string, maxLines: number): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, Math.max(1, maxLines));
}

function compareArtifactAsc(
  left: { created_at: string },
  right: { created_at: string }
): number {
  const leftMs = Date.parse(left.created_at);
  const rightMs = Date.parse(right.created_at);
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;

  if (safeLeft !== safeRight) {
    return safeLeft - safeRight;
  }

  return 0;
}

function normalizeMaterialType(raw: unknown): WritingMaterialType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (
    value === "social_post"
    || value === "web_page"
    || value === "local_text"
    || value === "image"
    || value === "note"
    || value === "chat_record"
    || value === "mixed"
  ) {
    return value;
  }
  return "local_text";
}

function normalizeInputMode(raw: unknown): WritingMaterialInputMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "url" || value === "text" || value === "image" || value === "mixed") {
    return value;
  }
  return "text";
}

function normalizeDocumentMode(raw: unknown): WritingDocumentMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "knowledge_entry" || value === "article" || value === "memo" || value === "research_note") {
    return value;
  }
  return "knowledge_entry";
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
}

function normalizeIdentifier(raw: string, prefix: "mat" | "ins" | "doc", timestamp: string): string {
  const normalized = raw.trim();
  if (normalized) {
    return normalized;
  }
  return createArtifactId(prefix, timestamp);
}

function normalizeScore(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, parsed)).toFixed(2));
}

function safeVersion(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function normalizeTimestamp(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }

  const text = raw.trim();
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return new Date(parsed).toISOString();
}

function normalizePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function safeDate(rawTimestamp: string): Date {
  const parsed = Date.parse(rawTimestamp);
  if (Number.isFinite(parsed)) {
    return new Date(parsed);
  }
  return new Date();
}

function createUrlPattern(): RegExp {
  return /https?:\/\/[^\s)]+/gi;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}
