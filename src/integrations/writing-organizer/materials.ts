import { normalizeMultilineText } from "./shared";
import { WritingInsight, WritingMaterial, WritingMaterialInputMode, WritingMaterialType } from "./types";
import {
  asRecord,
  compareArtifactAsc,
  createArtifactId,
  createUrlPattern,
  listKnowledgeFiles,
  normalizeIdentifier,
  normalizeInputMode,
  normalizeMaterialType,
  normalizeStringArray,
  normalizeScore,
  normalizeTimestamp,
  readJsonFile,
  resolveKnowledgeFilePath,
  writeJsonFile
} from "./artifactHelpers";

const MATERIALS_DIR_NAME = "materials";
const INSIGHTS_DIR_NAME = "insights";

export function ingestMaterial(input: {
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

export function ensureMaterialsForSummarize(
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

export function extractInsight(input: {
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

export function persistMaterial(material: WritingMaterial): void {
  const filePath = resolveKnowledgeFilePath(
    material.topic_id,
    MATERIALS_DIR_NAME,
    material.created_at,
    `${material.id}.json`
  );
  writeJsonFile(filePath, material);
}

export function persistInsight(insight: WritingInsight): void {
  const filePath = resolveKnowledgeFilePath(
    insight.topic_id,
    INSIGHTS_DIR_NAME,
    insight.created_at,
    `${insight.id}.json`
  );
  writeJsonFile(filePath, insight);
}

export function loadMaterials(topicId: string): WritingMaterial[] {
  const files = listKnowledgeFiles(topicId, MATERIALS_DIR_NAME, ".json", (fileName) => !fileName.endsWith(".meta.json"));
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

export function loadInsights(topicId: string): WritingInsight[] {
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

function extractUrls(text: string): string[] {
  const matched = text.match(createUrlPattern());
  if (!matched) {
    return [];
  }
  return Array.from(new Set(matched.map((item) => item.trim()).filter((item) => item.length > 0)));
}

function inferInputMode(text: string, urls: string[]): WritingMaterialInputMode {
  const hasUrl = urls.length > 0;
  const hasImageMarker = /!\[[^\]]*\]\([^)]+\)/.test(text) || /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text);
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
