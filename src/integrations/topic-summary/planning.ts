import { jsonrepair } from "jsonrepair";
import { createLLMEngine } from "../../engines/llm";
import { DEFAULT_TARGET_LANGUAGE } from "./defaults";
import { asRecord, isRecord, normalizeText, toArray } from "./shared";
import {
  buildDigestSummary,
  detectLang,
  normalizeDigestType,
  sanitizeDigestSummary,
  sanitizeDigestTitle
} from "./text";
import { normalizeConfigDigestLanguage } from "./storage";
import {
  Candidate,
  PlanningDigestItemPatch,
  SelectedItem,
  TopicKey,
  TopicSummaryConfig,
  TopicSummaryExecuteOptions,
  TopicSummaryEngine
} from "./types";

export async function refineSelectedItemsWithPlanningModel(
  selected: SelectedItem[],
  targetLanguage: string,
  summaryEngine: TopicSummaryEngine
): Promise<SelectedItem[]> {
  if (selected.length === 0) {
    return selected;
  }

  const planningRefineEnabled = shouldUsePlanningModelRefine();
  let refined = selected;

  if (planningRefineEnabled) {
    try {
      const patches = await generatePlanningDigestPatchMap(selected, targetLanguage, summaryEngine);
      if (patches.size > 0) {
        refined = applyPlanningDigestPatches(selected, patches);
      }
    } catch (error) {
      console.warn(`topic-summary planning model refine failed: ${(error as Error).message ?? "unknown error"}`);
    }
  }

  const pendingLocalization = refined.filter((item, index) =>
    needsLocalizationFallback(selected[index], item, targetLanguage)
  );
  if (pendingLocalization.length === 0) {
    return refined;
  }

  try {
    const fallbackPatches = await generateLocalizationFallbackPatchMap(
      pendingLocalization,
      targetLanguage,
      summaryEngine
    );
    if (fallbackPatches.size === 0) {
      return refined;
    }
    return applyPlanningDigestPatches(refined, fallbackPatches);
  } catch (error) {
    console.warn(`topic-summary localization fallback failed: ${(error as Error).message ?? "unknown error"}`);
    return refined;
  }
}

export function resolveRunTargetLanguage(config: TopicSummaryConfig, options?: TopicSummaryExecuteOptions): string {
  const explicitLanguage = normalizeText(options?.explicitLanguage);
  if (explicitLanguage) {
    return normalizeDigestLanguage(explicitLanguage);
  }

  const configuredLanguage = normalizeConfigDigestLanguage(config.defaultLanguage);
  if (configuredLanguage !== "auto") {
    return configuredLanguage;
  }

  return normalizeDigestLanguage(options?.inferredLanguage);
}

export function normalizeDigestLanguage(raw: unknown): string {
  const envLanguage = normalizeText(process.env.TOPIC_SUMMARY_DEFAULT_LANGUAGE).toLowerCase();
  const fallback = envLanguage || DEFAULT_TARGET_LANGUAGE;
  const value = normalizeText(raw).toLowerCase() || fallback;

  if (value.startsWith("zh")) {
    return "zh-CN";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return value.slice(0, 24);
}

export function formatDigestLanguageLabel(language: string): string {
  const value = normalizeDigestLanguage(language);
  if (value === "zh-CN") {
    return "Simplified Chinese";
  }
  if (value === "en") {
    return "English";
  }
  return value;
}

function applyPlanningDigestPatches(
  selected: SelectedItem[],
  patches: Map<string, PlanningDigestItemPatch>
): SelectedItem[] {
  return selected.map((item) => {
    const patch = patches.get(item.candidate.id);
    if (!patch) {
      return item;
    }

    const nextTags = Array.isArray(patch.topicTags) && patch.topicTags.length > 0
      ? patch.topicTags
      : item.candidate.topicTags;
    const digestType = patch.digestType ?? item.digestType;
    const digestSummary = digestType === "deep_read"
      ? (patch.digestSummary || item.digestSummary || buildDigestSummary(item.candidate.summary))
      : "";

    return {
      ...item,
      candidate: {
        ...item.candidate,
        ...(patch.titleLocalized ? { title: patch.titleLocalized } : {}),
        topicTags: nextTags
      },
      digestType,
      digestSummary
    };
  });
}

function needsLocalizationFallback(
  original: SelectedItem,
  refined: SelectedItem,
  targetLanguage: string
): boolean {
  if (!shouldLocalizeDigestText(targetLanguage, original.candidate.lang)) {
    return false;
  }

  const originalTitle = sanitizeDigestTitle(original.candidate.title, 180) || original.candidate.title;
  const refinedTitle = sanitizeDigestTitle(refined.candidate.title, 180) || refined.candidate.title;
  if (refinedTitle === originalTitle || !isTextLocalizedForTarget(refinedTitle, targetLanguage)) {
    return true;
  }

  if (refined.digestType !== "deep_read") {
    return false;
  }

  const originalSummary = sanitizeDigestSummary(original.digestSummary, 160);
  const refinedSummary = sanitizeDigestSummary(refined.digestSummary, 160);
  if (!originalSummary) {
    return false;
  }
  return refinedSummary === originalSummary || !isTextLocalizedForTarget(refinedSummary, targetLanguage);
}

function shouldLocalizeDigestText(targetLanguage: string, sourceLang: Candidate["lang"]): boolean {
  const language = normalizeDigestLanguage(targetLanguage);
  if (language === "zh-CN") {
    return sourceLang !== "zh";
  }
  if (language === "en") {
    return sourceLang !== "en";
  }
  return true;
}

function isTextLocalizedForTarget(text: string, targetLanguage: string): boolean {
  const plain = normalizeText(text);
  if (!plain) {
    return false;
  }

  const language = normalizeDigestLanguage(targetLanguage);
  const detected = detectLang(plain);

  if (language === "zh-CN") {
    return detected === "zh";
  }
  if (language === "en") {
    return detected === "en";
  }
  return true;
}

async function generatePlanningDigestPatchMap(
  selected: SelectedItem[],
  targetLanguage: string,
  summaryEngine: TopicSummaryEngine
): Promise<Map<string, PlanningDigestItemPatch>> {
  const input = selected.map((item) => ({
    id: item.candidate.id,
    title: item.candidate.title,
    source_name: item.candidate.sourceName,
    category: item.candidate.category,
    published_at: item.candidate.publishedAt ?? "",
    topic_tags: item.candidate.topicTags,
    summary: item.candidate.summary,
    digest_type: item.digestType,
    digest_summary: item.digestSummary,
    url: item.candidate.url
  }));

  const languageLabel = formatDigestLanguageLabel(targetLanguage);
  const systemPrompt = [
    "You are an AI engineering digest editor.",
    `Translate all user-facing text to ${languageLabel}.`,
    "Task: For each item, produce a clean localized headline and classify it.",
    "Rules:",
    "1) title_localized: concise headline in target language. Keep proper nouns (product/model/company) when needed.",
    "2) Remove noisy prefixes/tokens in title: [ecosystem], [engineering], [news], [source:], source:, Show HN:.",
    "3) digest_type: must be one of news or deep_read.",
    "4) If digest_type=news: this is one-line quick news, keep brief_summary empty.",
    "5) If digest_type=deep_read: this is recommended deep reading, provide brief_summary in 1 concise sentence (<=80 Chinese chars or <=40 English words).",
    "6) topic_tags may be corrected but must be selected from llm_apps/agents/multimodal/reasoning/rag/eval/on_device/safety.",
    "7) Do not output links. Do not output markdown. Do not invent facts.",
    "Output strict JSON only:",
    "{\"items\":[{\"id\":\"...\",\"title_localized\":\"...\",\"digest_type\":\"news|deep_read\",\"brief_summary\":\"...\",\"topic_tags\":[\"agents\"]}]}"
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      task: "localize + classify digest items",
      target_language: targetLanguage,
      items: input
    },
    null,
    2
  );

  const raw = await chatWithPlanningModel(systemPrompt, userPrompt, summaryEngine);
  return parsePlanningDigestPatchMap(raw);
}

async function generateLocalizationFallbackPatchMap(
  selected: SelectedItem[],
  targetLanguage: string,
  summaryEngine: TopicSummaryEngine
): Promise<Map<string, PlanningDigestItemPatch>> {
  const input = selected.map((item) => ({
    id: item.candidate.id,
    source_language: item.candidate.lang,
    title: item.candidate.title,
    digest_type: item.digestType,
    brief_summary: item.digestSummary
  }));

  const languageLabel = formatDigestLanguageLabel(targetLanguage);
  const systemPrompt = [
    "You are localizing digest items for a message feed.",
    `Translate all user-facing text to ${languageLabel}.`,
    "Always keep the same id.",
    "Rules:",
    "1) title_localized: translate the title into the target language. Keep proper nouns when needed.",
    "2) brief_summary: if input brief_summary is empty, return an empty string. Otherwise translate it into the target language.",
    "3) Do not add facts. Do not add markdown. Do not add links.",
    "4) Return strict JSON only.",
    "Output format:",
    "{\"items\":[{\"id\":\"...\",\"title_localized\":\"...\",\"brief_summary\":\"...\"}]}"
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      task: "translate digest title and summary",
      target_language: targetLanguage,
      items: input
    },
    null,
    2
  );

  const raw = await chatWithPlanningModel(systemPrompt, userPrompt, summaryEngine);
  return parsePlanningDigestPatchMap(raw);
}

async function chatWithPlanningModel(
  systemPrompt: string,
  userPrompt: string,
  summaryEngine: TopicSummaryEngine
): Promise<string> {
  const selector = resolveTopicSummaryProviderSelector(summaryEngine);
  const llmEngine = createLLMEngine(selector);
  const provider = llmEngine.getProviderName();

  const model = String(llmEngine.getModelForStep("planning") || "").trim();
  if (!model) {
    throw new Error(`missing planning model for ${provider}`);
  }

  return llmEngine.chat({
    step: "general",
    model,
    timeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, 30000),
    ...(provider === "ollama"
      ? {
          options: {
            temperature: 0.2,
            top_p: 0.9,
            num_predict: 2048
          }
        }
      : {}),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });
}

function resolveTopicSummaryProviderSelector(summaryEngine: TopicSummaryEngine): string | undefined {
  const normalized = normalizeText(summaryEngine).toLowerCase();
  if (!normalized || normalized === "local" || normalized === "default" || normalized === "auto") {
    return undefined;
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(normalized)) {
    return "gpt-plugin";
  }
  return normalized;
}

function parsePlanningDigestPatchMap(raw: string): Map<string, PlanningDigestItemPatch> {
  const parsed = parseJsonLike(raw);
  const rows = Array.isArray(parsed)
    ? parsed
    : (isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : []);

  const patches = new Map<string, PlanningDigestItemPatch>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    const id = normalizeText(row.id);
    if (!id) {
      continue;
    }

    const titleLocalized = sanitizeDigestTitle(
      row.title_localized ?? row.titleLocalized ?? row.title_cn ?? row.titleCn ?? row.title,
      160
    );
    const digestType = normalizeDigestType(
      row.digest_type ?? row.digestType ?? row.type ?? row.classification ?? row.item_type
    );
    const digestSummary = sanitizeDigestSummary(
      row.brief_summary
      ?? row.briefSummary
      ?? row.summary_short
      ?? row.digest_summary
      ?? row.summary
      ?? row.why_cn
      ?? row.whyCn
      ?? row.why,
      160
    );
    const topicTags = toArray(row.topic_tags ?? row.topicTags)
      .map((item) => normalizeTopicKey(item))
      .filter((item): item is TopicKey => Boolean(item));

    patches.set(id, {
      id,
      ...(titleLocalized ? { titleLocalized } : {}),
      ...(digestType ? { digestType } : {}),
      ...((digestType === "deep_read" || (!digestType && digestSummary)) && digestSummary
        ? { digestSummary }
        : {}),
      ...(topicTags.length > 0 ? { topicTags } : {})
    });
  }

  return patches;
}

function parseJsonLike(raw: string): unknown {
  const text = String(raw ?? "").trim();
  if (!text) {
    return {};
  }

  const normalized = stripCodeFence(extractLikelyJsonBlock(text));
  if (!normalized) {
    return {};
  }

  try {
    return JSON.parse(normalized);
  } catch {
    try {
      const repaired = jsonrepair(normalized);
      return JSON.parse(repaired);
    } catch {
      return {};
    }
  }
}

function extractLikelyJsonBlock(text: string): string {
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1);
  }
  return text;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3) {
    return trimmed;
  }
  if (!lines[lines.length - 1].trim().startsWith("```")) {
    return trimmed;
  }
  return lines.slice(1, -1).join("\n").trim();
}

function normalizeTopicKey(raw: unknown): TopicKey | null {
  const value = normalizeText(raw).toLowerCase().replace(/-/g, "_");
  if (!value) {
    return null;
  }
  if (value === "llmapps") return "llm_apps";
  if (value === "ondevice") return "on_device";
  const supported: TopicKey[] = ["llm_apps", "agents", "multimodal", "reasoning", "rag", "eval", "on_device", "safety"];
  return supported.includes(value as TopicKey) ? (value as TopicKey) : null;
}

function shouldUsePlanningModelRefine(): boolean {
  const raw = String(process.env.TOPIC_SUMMARY_USE_PLANNING_MODEL ?? "true").trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(raw)) {
    return false;
  }
  return true;
}

function parsePositiveInteger(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
