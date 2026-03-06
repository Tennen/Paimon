import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";
import { jsonrepair } from "jsonrepair";
import { DATA_STORE, getStore, registerStore, setStore } from "../../storage/persistence";
import { ollamaChat } from "../../engines/llm/ollama/client";
import { llamaServerChat } from "../../engines/llm/llama-server/client";
import * as chatgptBridge from "../chatgpt-bridge/service";

export const directCommands = ["/topic"];

export type TopicPushCategory = "engineering" | "news" | "ecosystem";

export type TopicKey =
  | "llm_apps"
  | "agents"
  | "multimodal"
  | "reasoning"
  | "rag"
  | "eval"
  | "on_device"
  | "safety";

export type TopicPushSource = {
  id: string;
  name: string;
  category: TopicPushCategory;
  feedUrl: string;
  weight: number;
  enabled: boolean;
};

export type TopicPushFilters = {
  timeWindowHours: number;
  minTitleLength: number;
  blockedDomains: string[];
  blockedKeywordsInTitle: string[];
  maxPerDomain: number;
  dedup: {
    titleSimilarityThreshold: number;
    urlNormalization: boolean;
  };
};

export type TopicPushDailyQuota = {
  total: number;
  engineering: number;
  news: number;
  ecosystem: number;
};

export type TopicPushSummaryEngine = "local" | "gpt_plugin";
export type TopicPushDigestLanguage = "auto" | "zh-CN" | "en";

export type TopicPushConfig = {
  version: 1;
  summaryEngine: TopicPushSummaryEngine;
  defaultLanguage: TopicPushDigestLanguage;
  sources: TopicPushSource[];
  topics: Record<TopicKey, string[]>;
  filters: TopicPushFilters;
  dailyQuota: TopicPushDailyQuota;
};

export type TopicPushSentLogItem = {
  urlNormalized: string;
  sentAt: string;
  title: string;
};

export type TopicPushState = {
  version: 1;
  sentLog: TopicPushSentLogItem[];
  updatedAt: string;
};

export type TopicPushProfileSnapshot = {
  id: string;
  name: string;
  isActive: boolean;
  config: TopicPushConfig;
  state: TopicPushState;
};

export type TopicPushSnapshot = {
  activeProfileId: string;
  profiles: TopicPushProfileSnapshot[];
};

export type TopicPushProfileCreateInput = {
  id?: string;
  name: string;
  cloneFrom?: string;
};

export type TopicPushProfileUpdateInput = {
  name?: string;
};

type TopicPushProfileConfig = {
  id: string;
  name: string;
  config: TopicPushConfig;
};

type TopicPushProfileState = {
  id: string;
  state: TopicPushState;
};

type TopicPushConfigStore = {
  version: 2;
  activeProfileId: string;
  profiles: TopicPushProfileConfig[];
};

type TopicPushStateStore = {
  version: 2;
  profiles: TopicPushProfileState[];
};

type FeedEntry = {
  title: string;
  link: string;
  publishedAtRaw: string;
  summary: string;
};

type FeedFetchResult = {
  source: TopicPushSource;
  fetchedAt: string;
  entries: FeedEntry[];
  error?: string;
};

type Candidate = {
  id: string;
  title: string;
  url: string;
  urlNormalized: string;
  sourceId: string;
  sourceName: string;
  category: TopicPushCategory;
  publishedAt: string | null;
  fetchedAt: string;
  summary: string;
  lang: "zh" | "en" | "unknown";
  topicTags: TopicKey[];
  score: number;
  domain: string;
};

type TopicDigestItemType = "news" | "deep_read";

export type TopicPushExecuteOptions = {
  explicitLanguage?: string;
  inferredLanguage?: string;
};

type SelectedItem = {
  candidate: Candidate;
  digestType: TopicDigestItemType;
  digestSummary: string;
  rank: number;
  fallbackFill: boolean;
};

type ParsedCommand =
  | { kind: "run"; profileId?: string }
  | { kind: "help" }
  | { kind: "sources_list"; profileId?: string }
  | { kind: "sources_get"; id: string; profileId?: string }
  | {
      kind: "sources_add";
      profileId?: string;
      payload: {
        id?: string;
        name: string;
        category: TopicPushCategory;
        feedUrl: string;
        weight?: number;
        enabled?: boolean;
      };
    }
  | {
      kind: "sources_update";
      id: string;
      profileId?: string;
      patch: {
        name?: string;
        category?: TopicPushCategory;
        feedUrl?: string;
        weight?: number;
        enabled?: boolean;
      };
    }
  | { kind: "sources_delete"; id: string; profileId?: string }
  | { kind: "sources_toggle"; id: string; enabled: boolean; profileId?: string }
  | { kind: "profiles_list" }
  | { kind: "profiles_get"; id: string }
  | {
      kind: "profiles_add";
      payload: {
        id?: string;
        name: string;
        cloneFrom?: string;
      };
    }
  | {
      kind: "profiles_update";
      id: string;
      patch: {
        name?: string;
      };
    }
  | { kind: "profiles_use"; id: string }
  | { kind: "profiles_delete"; id: string }
  | { kind: "config_show"; profileId?: string }
  | { kind: "state_show"; profileId?: string }
  | { kind: "state_clear_sent"; profileId?: string };

type DigestRunResult = {
  now: string;
  selected: SelectedItem[];
  selectedByCategory: Record<TopicPushCategory, number>;
  fetchedSources: number;
  totalSources: number;
  fetchErrors: Array<{ sourceId: string; sourceName: string; error: string }>;
  rawItemCount: number;
  candidateCount: number;
  dedupedCount: number;
  unsentCount: number;
};

type PlanningDigestItemPatch = {
  id: string;
  titleLocalized?: string;
  digestType?: TopicDigestItemType;
  digestSummary?: string;
  topicTags?: TopicKey[];
};

const TOPIC_KEYS: TopicKey[] = [
  "llm_apps",
  "agents",
  "multimodal",
  "reasoning",
  "rag",
  "eval",
  "on_device",
  "safety"
];

const TRACKING_QUERY_PARAMS = new Set([
  "ref",
  "ref_src",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "spm"
]);

const ENGINEERING_SIGNAL_KEYWORDS = [
  "benchmark",
  "eval",
  "evaluation",
  "inference",
  "latency",
  "quantization",
  "rag",
  "agent",
  "tool calling",
  "fine-tuning"
];

const SENT_LOG_RETENTION_DAYS = 120;
const SENT_LOG_MAX_ITEMS = 5000;
const FEED_FETCH_TIMEOUT_MS = 12000;
const DEFAULT_PROFILE_ID = "ai-engineering";
const DEFAULT_PROFILE_NAME = "AI Engineering";
const LEGACY_DAILY_QUOTA = {
  total: 10,
  engineering: 7,
  news: 2,
  ecosystem: 1
} as const;
const DEFAULT_TARGET_LANGUAGE = "zh-CN";

const TOPIC_PUSH_CONFIG_STORE = DATA_STORE.TOPIC_PUSH_CONFIG;
const TOPIC_PUSH_STATE_STORE = DATA_STORE.TOPIC_PUSH_STATE;
const LEGACY_FEED_URL_MIGRATION: Record<string, string> = {
  "https://eng.uber.com/feed": "https://www.uber.com/blog/engineering/feed/",
  "https://eng.uber.com/feed/": "https://www.uber.com/blog/engineering/feed/",
  "https://www.interconnects.ai/rss": "https://www.interconnects.ai/feed",
  "https://www.interconnects.ai/rss/": "https://www.interconnects.ai/feed"
};
const LEGACY_FEED_DISABLE_LIST = new Set([
  "https://www.anthropic.com/news/rss",
  "https://www.anthropic.com/news/rss.xml"
]);

const DEFAULT_SOURCES: TopicPushSource[] = [
  {
    id: "openai-blog",
    name: "OpenAI Blog",
    category: "engineering",
    feedUrl: "https://openai.com/blog/rss.xml",
    weight: 1.2,
    enabled: true
  },
  {
    id: "huggingface-blog",
    name: "Hugging Face Blog",
    category: "engineering",
    feedUrl: "https://huggingface.co/blog/feed.xml",
    weight: 1.1,
    enabled: true
  },
  {
    id: "deepmind-blog",
    name: "DeepMind Blog",
    category: "engineering",
    feedUrl: "https://deepmind.google/blog/rss.xml",
    weight: 1.0,
    enabled: true
  },
  {
    id: "netflix-tech-blog",
    name: "Netflix Tech Blog",
    category: "engineering",
    feedUrl: "https://netflixtechblog.com/feed",
    weight: 1.0,
    enabled: true
  },
  {
    id: "uber-engineering",
    name: "Uber Engineering",
    category: "engineering",
    feedUrl: "https://www.uber.com/blog/engineering/feed/",
    weight: 1.0,
    enabled: true
  },
  {
    id: "aws-ml-blog",
    name: "AWS ML Blog",
    category: "engineering",
    feedUrl: "https://aws.amazon.com/blogs/machine-learning/feed/",
    weight: 1.0,
    enabled: true
  },
  {
    id: "google-cloud-ai-ml",
    name: "Google Cloud AI/ML",
    category: "engineering",
    feedUrl: "https://cloud.google.com/blog/products/ai-machine-learning/rss",
    weight: 1.0,
    enabled: true
  },
  {
    id: "simon-willison",
    name: "Simon Willison",
    category: "engineering",
    feedUrl: "https://simonwillison.net/atom/everything/",
    weight: 1.1,
    enabled: true
  },
  {
    id: "lilian-weng",
    name: "Lilian Weng",
    category: "engineering",
    feedUrl: "https://lilianweng.github.io/posts/index.xml",
    weight: 1.0,
    enabled: true
  },
  {
    id: "interconnects",
    name: "Interconnects",
    category: "engineering",
    feedUrl: "https://www.interconnects.ai/feed",
    weight: 1.0,
    enabled: true
  },
  {
    id: "techcrunch-ai",
    name: "TechCrunch AI",
    category: "news",
    feedUrl: "https://techcrunch.com/tag/artificial-intelligence/feed/",
    weight: 1.0,
    enabled: true
  },
  {
    id: "the-verge-ai",
    name: "The Verge AI",
    category: "news",
    feedUrl: "https://www.theverge.com/rss/ai/index.xml",
    weight: 1.0,
    enabled: true
  },
  {
    id: "hn-ai",
    name: "HN AI query",
    category: "ecosystem",
    feedUrl: "https://hnrss.org/newest?q=AI",
    weight: 0.9,
    enabled: true
  },
  {
    id: "langchain-blog",
    name: "LangChain Blog",
    category: "ecosystem",
    feedUrl: "https://blog.langchain.dev/rss/",
    weight: 1.0,
    enabled: true
  }
];

const DEFAULT_TOPIC_KEYWORDS: Record<TopicKey, string[]> = {
  llm_apps: [
    "llm app",
    "llm application",
    "ai assistant",
    "copilot",
    "workflow",
    "agent workflow",
    "应用",
    "智能助手"
  ],
  agents: [
    "agent",
    "agents",
    "agentic",
    "tool calling",
    "multi-agent",
    "autonomous agent",
    "function calling",
    "智能体"
  ],
  multimodal: [
    "multimodal",
    "vision-language",
    "vlm",
    "image generation",
    "video generation",
    "speech",
    "audio",
    "多模态"
  ],
  reasoning: [
    "reasoning",
    "inference-time",
    "test-time compute",
    "chain-of-thought",
    "deliberate",
    "推理"
  ],
  rag: [
    "rag",
    "retrieval augmented",
    "retrieval-augmented",
    "vector database",
    "embedding",
    "knowledge base",
    "检索增强",
    "知识库"
  ],
  eval: [
    "eval",
    "evaluation",
    "benchmark",
    "judge",
    "swe-bench",
    "评测",
    "基准"
  ],
  on_device: [
    "on-device",
    "edge ai",
    "mobile ai",
    "quantization",
    "distillation",
    "tinyml",
    "端侧",
    "本地模型"
  ],
  safety: [
    "safety",
    "alignment",
    "jailbreak",
    "prompt injection",
    "red team",
    "guardrail",
    "安全",
    "对齐"
  ]
};

const DEFAULT_CONFIG: TopicPushConfig = {
  version: 1,
  summaryEngine: "local",
  defaultLanguage: "auto",
  sources: DEFAULT_SOURCES,
  topics: DEFAULT_TOPIC_KEYWORDS,
  filters: {
    timeWindowHours: 24,
    minTitleLength: 8,
    blockedDomains: ["arxiv.org"],
    blockedKeywordsInTitle: ["arxiv", "paper", "论文", "preprint"],
    maxPerDomain: 2,
    dedup: {
      titleSimilarityThreshold: 0.9,
      urlNormalization: true
    }
  },
  dailyQuota: {
    total: 20,
    engineering: 12,
    news: 5,
    ecosystem: 3
  }
};

const DEFAULT_STATE: TopicPushState = {
  version: 1,
  sentLog: [],
  updatedAt: ""
};

const DEFAULT_CONFIG_STORE: TopicPushConfigStore = {
  version: 2,
  activeProfileId: DEFAULT_PROFILE_ID,
  profiles: [
    {
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      config: DEFAULT_CONFIG
    }
  ]
};

const DEFAULT_STATE_STORE: TopicPushStateStore = {
  version: 2,
  profiles: [
    {
      id: DEFAULT_PROFILE_ID,
      state: DEFAULT_STATE
    }
  ]
};

export async function execute(
  input: string,
  options?: TopicPushExecuteOptions
): Promise<{ text: string; result?: unknown }> {
  try {
    ensureTopicPushStorage();
    const command = parseCommand(input);

    switch (command.kind) {
      case "help":
        return { text: buildHelpText() };
      case "sources_list":
        return { text: formatSources(readConfig(command.profileId).sources, command.profileId) };
      case "sources_get":
        return { text: formatSingleSource(command.id, command.profileId) };
      case "sources_add":
        return { text: handleAddSource(command.payload, command.profileId) };
      case "sources_update":
        return { text: handleUpdateSource(command.id, command.patch, command.profileId) };
      case "sources_delete":
        return { text: handleDeleteSource(command.id, command.profileId) };
      case "sources_toggle":
        return { text: handleToggleSource(command.id, command.enabled, command.profileId) };
      case "profiles_list":
        return { text: formatProfiles() };
      case "profiles_get":
        return { text: formatSingleProfile(command.id) };
      case "profiles_add":
        return { text: handleAddProfile(command.payload) };
      case "profiles_update":
        return { text: handleUpdateProfile(command.id, command.patch) };
      case "profiles_use":
        return { text: handleUseProfile(command.id) };
      case "profiles_delete":
        return { text: handleDeleteProfile(command.id) };
      case "config_show":
        return { text: formatConfig(readConfig(command.profileId), command.profileId) };
      case "state_show":
        return { text: formatState(readState(command.profileId), command.profileId) };
      case "state_clear_sent":
        return { text: handleClearSentLog(command.profileId) };
      case "run": {
        const now = new Date();
        const config = readConfig(command.profileId);
        const state = readState(command.profileId);
        const profile = getProfileMeta(command.profileId);
        const targetLanguage = resolveRunTargetLanguage(config, options);
        const run = await runDigest(config, state, now, targetLanguage);
        const nextState = mergeSentLog(state, run.selected, now);
        writeState(nextState, profile.id);
        return {
          text: formatDigest(run, profile, targetLanguage),
          result: {
            profileId: profile.id,
            profileName: profile.name,
            selectedCount: run.selected.length,
            selectedByCategory: run.selectedByCategory,
            fetchedSources: run.fetchedSources,
            totalSources: run.totalSources,
            rawItemCount: run.rawItemCount,
            candidateCount: run.candidateCount,
            dedupedCount: run.dedupedCount,
            unsentCount: run.unsentCount,
            fetchErrors: run.fetchErrors
          }
        };
      }
      default:
        return { text: buildHelpText() };
    }
  } catch (error) {
    return {
      text: `Topic Push 执行失败: ${(error as Error).message ?? "unknown error"}`
    };
  }
}

export function getTopicPushConfig(profileId?: string): TopicPushConfig {
  ensureTopicPushStorage();
  return readConfig(profileId);
}

export function setTopicPushConfig(input: unknown, profileId?: string): TopicPushConfig {
  ensureTopicPushStorage();
  const config = normalizeConfig(input);
  writeConfig(config, profileId);
  return config;
}

export function getTopicPushState(profileId?: string): TopicPushState {
  ensureTopicPushStorage();
  return readState(profileId);
}

export function clearTopicPushSentLog(profileId?: string): TopicPushState {
  ensureTopicPushStorage();
  const next: TopicPushState = {
    version: 1,
    sentLog: [],
    updatedAt: new Date().toISOString()
  };
  writeState(next, profileId);
  return next;
}

export function getTopicPushSnapshot(): TopicPushSnapshot {
  ensureTopicPushStorage();
  return buildTopicPushSnapshot();
}

export function addTopicPushProfile(input: TopicPushProfileCreateInput): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleAddProfile(input);
  return buildTopicPushSnapshot();
}

export function updateTopicPushProfile(id: string, patch: TopicPushProfileUpdateInput): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleUpdateProfile(id, patch);
  return buildTopicPushSnapshot();
}

export function useTopicPushProfile(id: string): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleUseProfile(id);
  return buildTopicPushSnapshot();
}

export function deleteTopicPushProfile(id: string): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleDeleteProfile(id);
  return buildTopicPushSnapshot();
}

function ensureTopicPushStorage(): void {
  registerStore(TOPIC_PUSH_CONFIG_STORE, () => DEFAULT_CONFIG_STORE);
  registerStore(TOPIC_PUSH_STATE_STORE, () => DEFAULT_STATE_STORE);
}

function buildTopicPushSnapshot(): TopicPushSnapshot {
  const configStore = readConfigStore();
  const stateStore = readStateStore();

  const profiles = configStore.profiles.map((profile) => {
    const state = stateStore.profiles.find((item) => item.id === profile.id)?.state ?? cloneDefaultState();
    return {
      id: profile.id,
      name: profile.name,
      isActive: profile.id === configStore.activeProfileId,
      config: normalizeConfig(profile.config),
      state: normalizeState(state)
    };
  });

  return {
    activeProfileId: configStore.activeProfileId,
    profiles
  };
}

function readConfig(profileId?: string): TopicPushConfig {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  return profile.config;
}

function writeConfig(config: TopicPushConfig, profileId?: string): void {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  profile.config = normalizeConfig(config);
  writeConfigStore(store);
}

function readState(profileId?: string): TopicPushState {
  const configStore = readConfigStore();
  const profile = getProfileById(configStore, profileId);
  const stateStore = readStateStore();
  const entry = stateStore.profiles.find((item) => item.id === profile.id);
  return entry?.state ? normalizeState(entry.state) : cloneDefaultState();
}

function writeState(state: TopicPushState, profileId?: string): void {
  const configStore = readConfigStore();
  const profile = getProfileById(configStore, profileId);
  const stateStore = readStateStore();
  const index = stateStore.profiles.findIndex((item) => item.id === profile.id);
  const normalized = normalizeState(state);
  if (index < 0) {
    stateStore.profiles.push({ id: profile.id, state: normalized });
  } else {
    stateStore.profiles[index] = { id: profile.id, state: normalized };
  }
  writeStateStore(stateStore);
}

function readConfigStore(): TopicPushConfigStore {
  const parsed = getStore<unknown>(TOPIC_PUSH_CONFIG_STORE);
  return normalizeConfigStore(parsed);
}

function writeConfigStore(store: TopicPushConfigStore): void {
  setStore(TOPIC_PUSH_CONFIG_STORE, normalizeConfigStore(store));
}

function readStateStore(): TopicPushStateStore {
  const parsed = getStore<unknown>(TOPIC_PUSH_STATE_STORE);
  return normalizeStateStore(parsed);
}

function writeStateStore(store: TopicPushStateStore): void {
  setStore(TOPIC_PUSH_STATE_STORE, normalizeStateStore(store));
}

function getProfileById(store: TopicPushConfigStore, requestedId?: string): TopicPushProfileConfig {
  const normalized = normalizeProfileId(requestedId ?? "");
  if (normalized) {
    const found = store.profiles.find((item) => item.id === normalized);
    if (!found) {
      throw new Error(`profile not found: ${normalized}`);
    }
    return found;
  }

  const active = store.profiles.find((item) => item.id === store.activeProfileId);
  if (active) {
    return active;
  }

  if (store.profiles.length > 0) {
    return store.profiles[0];
  }

  throw new Error("no topic profile configured");
}

function getProfileMeta(profileId?: string): {
  id: string;
  name: string;
  config: TopicPushConfig;
  isActive: boolean;
} {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  return {
    id: profile.id,
    name: profile.name,
    config: profile.config,
    isActive: profile.id === store.activeProfileId
  };
}

async function runDigest(
  config: TopicPushConfig,
  state: TopicPushState,
  now: Date,
  targetLanguage: string
): Promise<DigestRunResult> {
  const enabledSources = config.sources.filter((source) => source.enabled);
  if (enabledSources.length === 0) {
    throw new Error("No enabled RSS source, use /topic source add or enable first");
  }

  const fetchResults = await Promise.all(enabledSources.map((source) => fetchSource(source, now)));
  const rawItemCount = fetchResults.reduce((sum, item) => sum + item.entries.length, 0);

  const candidates = buildCandidates(fetchResults, config, now);
  const deduped = deduplicateCandidates(candidates, config.filters.dedup.titleSimilarityThreshold);

  const sentSet = new Set(state.sentLog.map((entry) => entry.urlNormalized));
  const unsent = deduped.filter((item) => !sentSet.has(item.urlNormalized));

  const selectedRaw: SelectedItem[] = selectCandidates(unsent, config.dailyQuota, config.filters.maxPerDomain)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      digestType: getDefaultDigestType(item.candidate),
      digestSummary: buildDigestSummary(item.candidate)
    }));

  const selected = await refineSelectedItemsWithPlanningModel(selectedRaw, targetLanguage, config.summaryEngine);

  const selectedByCategory = {
    engineering: selected.filter((item) => item.candidate.category === "engineering").length,
    news: selected.filter((item) => item.candidate.category === "news").length,
    ecosystem: selected.filter((item) => item.candidate.category === "ecosystem").length
  } as Record<TopicPushCategory, number>;

  const fetchErrors = fetchResults
    .filter((item) => typeof item.error === "string")
    .map((item) => ({
      sourceId: item.source.id,
      sourceName: item.source.name,
      error: item.error ?? "unknown error"
    }));

  return {
    now: now.toISOString(),
    selected,
    selectedByCategory,
    fetchedSources: fetchResults.length - fetchErrors.length,
    totalSources: fetchResults.length,
    fetchErrors,
    rawItemCount,
    candidateCount: candidates.length,
    dedupedCount: deduped.length,
    unsentCount: unsent.length
  };
}

async function fetchSource(source: TopicPushSource, now: Date): Promise<FeedFetchResult> {
  const fetchedAt = now.toISOString();

  try {
    const xml = await fetchText(source.feedUrl, FEED_FETCH_TIMEOUT_MS);
    const entries = parseFeedEntries(xml);
    return {
      source,
      fetchedAt,
      entries
    };
  } catch (error) {
    return {
      source,
      fetchedAt,
      entries: [],
      error: (error as Error).message ?? "fetch failed"
    };
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Paimon-TopicPush/1.0",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.6"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseFeedEntries(xml: string): FeedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    processEntities: true
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const root = asRecord(parsed);
  if (!root) {
    return [];
  }

  const rss = asRecord(root.rss);
  if (rss) {
    return parseRssLikeItems(rss);
  }

  const channelRoot = asRecord(root.channel);
  if (channelRoot) {
    return parseRssLikeItems(root);
  }

  const atom = asRecord(root.feed);
  if (atom) {
    return parseAtomEntries(atom);
  }

  const rdf = asRecord(root["rdf:RDF"]);
  if (rdf) {
    return parseRssRdfEntries(rdf);
  }

  return [];
}

function parseRssLikeItems(rssRoot: Record<string, unknown>): FeedEntry[] {
  const channelRaw = rssRoot.channel;
  const channel = Array.isArray(channelRaw)
    ? asRecord(channelRaw[0])
    : asRecord(channelRaw) ?? rssRoot;
  if (!channel) {
    return [];
  }

  const items = toArray(channel.item)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return items.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractLink(item.link),
    publishedAtRaw: normalizeText(toText(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"])),
    summary: normalizeText(toText(item.description ?? item.summary ?? item["content:encoded"] ?? item.content))
  }));
}

function parseAtomEntries(feed: Record<string, unknown>): FeedEntry[] {
  const entries = toArray(feed.entry)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  return entries.map((entry) => ({
    title: normalizeText(toText(entry.title)),
    link: extractAtomLink(entry.link),
    publishedAtRaw: normalizeText(toText(entry.published ?? entry.updated ?? entry["dc:date"])),
    summary: normalizeText(toText(entry.summary ?? entry.content ?? entry.description))
  }));
}

function parseRssRdfEntries(rdf: Record<string, unknown>): FeedEntry[] {
  const items = toArray(rdf.item)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return items.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractLink(item.link),
    publishedAtRaw: normalizeText(toText(item["dc:date"] ?? item.pubDate ?? item.published)),
    summary: normalizeText(toText(item.description ?? item.summary ?? item["content:encoded"] ?? item.content))
  }));
}

function buildCandidates(fetchResults: FeedFetchResult[], config: TopicPushConfig, now: Date): Candidate[] {
  const out: Candidate[] = [];
  const cutoffMs = now.getTime() - config.filters.timeWindowHours * 3600 * 1000;
  const blockedDomains = config.filters.blockedDomains.map((item) => item.toLowerCase());
  const blockedTitleKeywords = config.filters.blockedKeywordsInTitle.map((item) => item.toLowerCase());

  for (const result of fetchResults) {
    for (const entry of result.entries) {
      const title = normalizeTitle(entry.title);
      if (!title || title.length < config.filters.minTitleLength) {
        continue;
      }

      const rawUrl = normalizeText(entry.link);
      if (!rawUrl) {
        continue;
      }

      const urlNormalized = config.filters.dedup.urlNormalization
        ? normalizeUrl(rawUrl)
        : rawUrl;
      if (!urlNormalized) {
        continue;
      }

      const domain = extractDomain(urlNormalized);
      if (domain && isDomainBlocked(domain, blockedDomains)) {
        continue;
      }

      const titleLower = title.toLowerCase();
      if (blockedTitleKeywords.some((keyword) => keyword && titleLower.includes(keyword))) {
        continue;
      }

      const publishedAt = parseDateToIso(entry.publishedAtRaw);
      if (publishedAt) {
        const publishedMs = Date.parse(publishedAt);
        if (Number.isFinite(publishedMs) && publishedMs < cutoffMs) {
          continue;
        }
      }

      const summary = normalizeSummary(entry.summary);
      const topicTags = detectTopicTags(title, summary, config.topics);
      const lang = detectLang(`${title} ${summary}`);
      const score = scoreCandidate({
        title,
        summary,
        topicTags,
        publishedAt,
        lang,
        sourceWeight: result.source.weight,
        now
      });

      out.push({
        id: buildStableHash(urlNormalized),
        title,
        url: rawUrl,
        urlNormalized,
        sourceId: result.source.id,
        sourceName: result.source.name,
        category: result.source.category,
        publishedAt,
        fetchedAt: result.fetchedAt,
        summary,
        lang,
        topicTags,
        score,
        domain
      });
    }
  }

  return out;
}

function deduplicateCandidates(candidates: Candidate[], titleThreshold: number): Candidate[] {
  const dedupByUrl = new Map<string, Candidate>();

  for (const item of candidates) {
    const existing = dedupByUrl.get(item.urlNormalized);
    if (!existing || isBetterCandidate(item, existing)) {
      dedupByUrl.set(item.urlNormalized, item);
    }
  }

  const dedupedByUrl = Array.from(dedupByUrl.values())
    .sort((left, right) => right.score - left.score);

  const kept: Candidate[] = [];
  for (const item of dedupedByUrl) {
    const duplicated = kept.some((existing) => titleSimilarity(existing.title, item.title) >= titleThreshold);
    if (!duplicated) {
      kept.push(item);
    }
  }

  return kept;
}

function selectCandidates(candidates: Candidate[], quota: TopicPushDailyQuota, maxPerDomain: number): SelectedItem[] {
  const maxDomain = maxPerDomain <= 0 ? Number.POSITIVE_INFINITY : maxPerDomain;
  const sorted = candidates.slice().sort((left, right) => right.score - left.score);

  const buckets: Record<TopicPushCategory, Candidate[]> = {
    engineering: sorted.filter((item) => item.category === "engineering"),
    news: sorted.filter((item) => item.category === "news"),
    ecosystem: sorted.filter((item) => item.category === "ecosystem")
  };

  const used = new Set<string>();
  const domainCounter = new Map<string, number>();
  const selected: Array<Omit<SelectedItem, "rank" | "digestType" | "digestSummary">> = [];

  pickFromBucket(
    buckets.engineering,
    normalizeQuotaNumber(quota.engineering, DEFAULT_CONFIG.dailyQuota.engineering),
    false,
    selected,
    used,
    domainCounter,
    maxDomain
  );
  pickFromBucket(
    buckets.news,
    normalizeQuotaNumber(quota.news, DEFAULT_CONFIG.dailyQuota.news),
    false,
    selected,
    used,
    domainCounter,
    maxDomain
  );
  pickFromBucket(
    buckets.ecosystem,
    normalizeQuotaNumber(quota.ecosystem, DEFAULT_CONFIG.dailyQuota.ecosystem),
    false,
    selected,
    used,
    domainCounter,
    maxDomain
  );

  const total = normalizeQuotaNumber(quota.total, DEFAULT_CONFIG.dailyQuota.total);
  let needed = Math.max(0, total - selected.length);

  if (needed > 0) {
    const fallbackOrder: TopicPushCategory[] = ["engineering", "ecosystem", "news"];
    for (const category of fallbackOrder) {
      if (needed <= 0) break;
      const before = selected.length;
      pickFromBucket(buckets[category], needed, true, selected, used, domainCounter, maxDomain);
      needed -= selected.length - before;
    }
  }

  if (needed > 0) {
    const before = selected.length;
    pickFromBucket(sorted, needed, true, selected, used, domainCounter, maxDomain);
    needed -= selected.length - before;
  }

  return selected
    .slice(0, total)
    .sort((left, right) => right.candidate.score - left.candidate.score)
    .map((item) => ({
      ...item,
      rank: 0,
      digestType: getDefaultDigestType(item.candidate),
      digestSummary: ""
    }));
}

function pickFromBucket(
  bucket: Candidate[],
  count: number,
  fallbackFill: boolean,
  selected: Array<Omit<SelectedItem, "rank" | "digestType" | "digestSummary">>,
  used: Set<string>,
  domainCounter: Map<string, number>,
  maxPerDomain: number
): void {
  if (count <= 0) {
    return;
  }

  let picked = 0;
  for (const item of bucket) {
    if (picked >= count) {
      return;
    }
    if (used.has(item.id)) {
      continue;
    }

    const domain = item.domain;
    if (domain) {
      const usedCount = domainCounter.get(domain) ?? 0;
      if (usedCount >= maxPerDomain) {
        continue;
      }
      domainCounter.set(domain, usedCount + 1);
    }

    used.add(item.id);
    selected.push({
      candidate: item,
      fallbackFill
    });
    picked += 1;
  }
}

async function refineSelectedItemsWithPlanningModel(
  selected: SelectedItem[],
  targetLanguage: string,
  summaryEngine: TopicPushSummaryEngine
): Promise<SelectedItem[]> {
  if (selected.length === 0) {
    return selected;
  }

  if (!shouldUsePlanningModelRefine()) {
    return selected;
  }

  try {
    const patches = await generatePlanningDigestPatchMap(selected, targetLanguage, summaryEngine);
    if (patches.size === 0) {
      return selected;
    }

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
        ? (patch.digestSummary || item.digestSummary || buildDigestSummary(item.candidate))
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
  } catch (error) {
    console.warn(`topic-push planning model refine failed: ${(error as Error).message ?? "unknown error"}`);
    return selected;
  }
}

async function generatePlanningDigestPatchMap(
  selected: SelectedItem[],
  targetLanguage: string,
  summaryEngine: TopicPushSummaryEngine
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

async function chatWithPlanningModel(
  systemPrompt: string,
  userPrompt: string,
  summaryEngine: TopicPushSummaryEngine
): Promise<string> {
  if (summaryEngine === "gpt_plugin") {
    return chatWithGptPluginBridge(systemPrompt, userPrompt);
  }

  const provider = normalizeLlmProvider(process.env.LLM_PROVIDER);

  if (provider === "llama-server") {
    const model = String(
      process.env.LLAMA_SERVER_PLANNING_MODEL
      ?? process.env.LLAMA_SERVER_MODEL
      ?? process.env.OLLAMA_PLANNING_MODEL
      ?? process.env.OLLAMA_MODEL
      ?? ""
    ).trim();
    if (!model) {
      throw new Error("missing planning model for llama-server");
    }

    return llamaServerChat({
      baseUrl: String(process.env.LLAMA_SERVER_BASE_URL ?? "http://127.0.0.1:8080").trim(),
      model,
      apiKey: String(process.env.LLAMA_SERVER_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim(),
      timeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, 30000),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });
  }

  const model = String(process.env.OLLAMA_PLANNING_MODEL ?? process.env.OLLAMA_MODEL ?? "").trim();
  if (!model) {
    throw new Error("missing planning model for ollama");
  }

  return ollamaChat({
    baseUrl: String(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").trim(),
    model,
    timeoutMs: parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, 30000),
    options: {
      temperature: 0.2,
      top_p: 0.9,
      num_predict: 2048
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });
}

async function chatWithGptPluginBridge(systemPrompt: string, userPrompt: string): Promise<string> {
  const bridgeHandler = chatgptBridge;
  if (!bridgeHandler || typeof bridgeHandler.execute !== "function") {
    throw new Error("gpt_plugin bridge execute() is missing");
  }

  const timeoutMs = parsePositiveInteger(
    process.env.TOPIC_PUSH_GPT_PLUGIN_TIMEOUT_MS,
    parsePositiveInteger(process.env.LLM_PLANNING_TIMEOUT_MS, 30000)
  );
  const bridgeInput = `/gpt new ${buildGptPluginPlanningPrompt(systemPrompt, userPrompt)}`;
  const response = await withTimeout(
    Promise.resolve(bridgeHandler.execute(bridgeInput)),
    timeoutMs,
    "gpt_plugin request timeout"
  );
  const text = extractTextFromBridgeResponse(response);
  if (!text) {
    throw new Error("gpt_plugin returned empty response");
  }
  return text;
}

function buildGptPluginPlanningPrompt(systemPrompt: string, userPrompt: string): string {
  return [
    "You are preparing output for an automated parser.",
    "Return strict JSON only. Do not include markdown, code fences, or explanations.",
    "<system_prompt>",
    systemPrompt,
    "</system_prompt>",
    "<user_prompt>",
    userPrompt,
    "</user_prompt>"
  ].join("\n");
}

function extractTextFromBridgeResponse(response: unknown): string {
  if (typeof response === "string") {
    return response.trim();
  }

  const record = asRecord(response);
  if (!record) {
    return "";
  }

  const directText = normalizeText(record.text);
  if (directText) {
    return directText;
  }

  const output = asRecord(record.output);
  if (!output) {
    return "";
  }
  return normalizeText(output.text);
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

function sanitizePlanningText(value: unknown, maxLength: number): string {
  const text = stripFeedMetadataNoise(normalizeText(value))
    .replace(/article\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/source\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\[(?:source|ecosystem|engineering|news)\s*:?\]/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-*]\s*/g, "")
    .trim();
  return clampText(text, maxLength);
}

function sanitizeDigestTitle(value: unknown, maxLength: number): string {
  const text = sanitizePlanningText(value, maxLength)
    .replace(/^show\s*hn\s*:\s*/i, "")
    .replace(/^source\s*:\s*/i, "")
    .replace(/^\[(?:source|ecosystem|engineering|news)\s*:?\]\s*/i, "")
    .trim();
  return clampText(text, maxLength);
}

function sanitizeDigestSummary(value: unknown, maxLength: number): string {
  const text = sanitizePlanningText(value, maxLength)
    .replace(/^(?:why|summary|brief)\s*:\s*/i, "")
    .trim();
  return clampText(text, maxLength);
}

function normalizeDigestType(raw: unknown): TopicDigestItemType | null {
  const value = normalizeText(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (!value) {
    return null;
  }
  if (["news", "brief", "brief_news", "quick_news", "one_line_news"].includes(value)) {
    return "news";
  }
  if (["deep_read", "deepread", "deep", "recommended", "recommendation", "long_read", "analysis"].includes(value)) {
    return "deep_read";
  }
  return null;
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
  return TOPIC_KEYS.includes(value as TopicKey) ? (value as TopicKey) : null;
}

function shouldUsePlanningModelRefine(): boolean {
  const raw = String(process.env.TOPIC_PUSH_USE_PLANNING_MODEL ?? "true").trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(raw)) {
    return false;
  }
  return true;
}

function normalizeLlmProvider(raw: string | undefined): "ollama" | "llama-server" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (["llama-server", "llama_server", "llama.cpp", "llamacpp", "llama"].includes(value)) {
    return "llama-server";
  }
  return "ollama";
}

function normalizeSummaryEngine(raw: unknown): TopicPushSummaryEngine {
  const value = normalizeText(raw).toLowerCase();
  if ([
    "gpt_plugin",
    "gpt-plugin",
    "gptplugin",
    "chatgpt-bridge",
    "chatgpt_bridge",
    "bridge"
  ].includes(value)) {
    return "gpt_plugin";
  }
  return "local";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function parsePositiveInteger(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeDigestLanguage(raw: unknown): string {
  const envLanguage = normalizeText(process.env.TOPIC_PUSH_DEFAULT_LANGUAGE).toLowerCase();
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

function normalizeConfigDigestLanguage(raw: unknown): TopicPushDigestLanguage {
  const value = normalizeText(raw).toLowerCase();
  if (!value || ["auto", "default", "detect", "auto-detect", "automatic", "自动"].includes(value)) {
    return "auto";
  }
  if (value.startsWith("zh")) {
    return "zh-CN";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return "auto";
}

function resolveRunTargetLanguage(config: TopicPushConfig, options?: TopicPushExecuteOptions): string {
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

function formatDigestLanguageLabel(language: string): string {
  const value = normalizeDigestLanguage(language);
  if (value === "zh-CN") {
    return "Simplified Chinese";
  }
  if (value === "en") {
    return "English";
  }
  return value;
}

function buildDigestSummary(candidate: Candidate): string {
  const summarySentence = firstSentence(candidate.summary);
  if (summarySentence) {
    return summarySentence;
  }

  return "";
}

function getDefaultDigestType(candidate: Candidate): TopicDigestItemType {
  return candidate.category === "news" ? "news" : "deep_read";
}

function mergeSentLog(state: TopicPushState, selected: SelectedItem[], now: Date): TopicPushState {
  const cutoffMs = now.getTime() - SENT_LOG_RETENTION_DAYS * 24 * 3600 * 1000;
  const merged = new Map<string, TopicPushSentLogItem>();

  for (const item of state.sentLog) {
    const sentMs = Date.parse(item.sentAt);
    if (Number.isFinite(sentMs) && sentMs < cutoffMs) {
      continue;
    }
    merged.set(item.urlNormalized, {
      urlNormalized: item.urlNormalized,
      sentAt: item.sentAt,
      title: item.title
    });
  }

  const nowIso = now.toISOString();
  for (const item of selected) {
    merged.set(item.candidate.urlNormalized, {
      urlNormalized: item.candidate.urlNormalized,
      sentAt: nowIso,
      title: item.candidate.title
    });
  }

  const sentLog = Array.from(merged.values())
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))
    .slice(0, SENT_LOG_MAX_ITEMS);

  return {
    version: 1,
    sentLog,
    updatedAt: nowIso
  };
}

function parseCommand(input: string): ParsedCommand {
  const raw = String(input ?? "").trim();
  const fromSlash = /^\/topic\b/i.test(raw);
  const body = fromSlash ? raw.replace(/^\/topic\b/i, "").trim() : raw;

  if (!body) {
    return { kind: "run" };
  }

  const tokens = tokenize(body);
  if (tokens.length === 0) {
    return { kind: "run" };
  }

  const first = tokens[0].toLowerCase();

  if (["help", "h", "?", "帮助"].includes(first)) {
    return { kind: "help" };
  }

  if (["run", "digest", "push", "today", "今日"].includes(first)) {
    const parsed = parseFlags(tokens.slice(1));
    const profileId = readProfileId(parsed.flagValues, parsed.positionals[0]);
    return { kind: "run", ...(profileId ? { profileId } : {}) };
  }

  if (["config", "settings", "配置"].includes(first)) {
    const parsed = parseFlags(tokens.slice(1));
    const profileId = readProfileId(parsed.flagValues, parsed.positionals[0]);
    return { kind: "config_show", ...(profileId ? { profileId } : {}) };
  }

  if (["state", "status", "stats", "状态"].includes(first)) {
    const parsed = parseFlags(tokens.slice(1));
    const second = parsed.positionals[0]?.toLowerCase();
    if (["clear", "reset", "clean", "清空"].includes(second ?? "")) {
      const profileId = readProfileId(parsed.flagValues, parsed.positionals[1]);
      return { kind: "state_clear_sent", ...(profileId ? { profileId } : {}) };
    }
    const profileId = readProfileId(parsed.flagValues, parsed.positionals[0]);
    return { kind: "state_show", ...(profileId ? { profileId } : {}) };
  }

  if (["source", "sources", "rss", "feeds", "源"].includes(first)) {
    return parseSourceCommand(tokens.slice(1));
  }

  if (["profile", "profiles", "entity", "entities", "batch", "分组", "实体", "批次"].includes(first)) {
    return parseProfileCommand(tokens.slice(1));
  }

  if (!fromSlash) {
    return { kind: "run" };
  }

  return { kind: "run" };
}

function parseSourceCommand(tokens: string[]): ParsedCommand {
  if (tokens.length === 0) {
    return { kind: "sources_list" };
  }

  const op = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const parsed = parseFlags(args);
  const profileId = readProfileId(parsed.flagValues);

  if (["list", "ls", "all", "列表"].includes(op)) {
    return { kind: "sources_list", ...(profileId ? { profileId } : {}) };
  }

  if (["get", "show", "详情"].includes(op)) {
    const id = normalizeSourceId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "source-id")
      ?? ""
    );
    if (!id) {
      throw new Error("source get 需要 id，例如: /topic source get openai-blog");
    }
    return { kind: "sources_get", id, ...(profileId ? { profileId } : {}) };
  }

  if (["delete", "remove", "rm", "del", "删除"].includes(op)) {
    const id = normalizeSourceId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "source-id")
      ?? ""
    );
    if (!id) {
      throw new Error("source delete 需要 id，例如: /topic source delete openai-blog");
    }
    return { kind: "sources_delete", id, ...(profileId ? { profileId } : {}) };
  }

  if (["enable", "启用"].includes(op)) {
    const id = normalizeSourceId(parsed.positionals[0] ?? readFlagString(parsed.flagValues, "id") ?? "");
    if (!id) {
      throw new Error("source enable 需要 id，例如: /topic source enable openai-blog");
    }
    return { kind: "sources_toggle", id, enabled: true, ...(profileId ? { profileId } : {}) };
  }

  if (["disable", "停用"].includes(op)) {
    const id = normalizeSourceId(parsed.positionals[0] ?? readFlagString(parsed.flagValues, "id") ?? "");
    if (!id) {
      throw new Error("source disable 需要 id，例如: /topic source disable openai-blog");
    }
    return { kind: "sources_toggle", id, enabled: false, ...(profileId ? { profileId } : {}) };
  }

  if (["add", "create", "新增"].includes(op)) {
    const name = String(parsed.flagValues.get("name") ?? parsed.flagValues.get("title") ?? "").trim();
    const category = normalizeCategory(parsed.flagValues.get("category") ?? parsed.flagValues.get("cat") ?? "");
    const feedUrl = String(parsed.flagValues.get("url") ?? parsed.flagValues.get("feed") ?? parsed.flagValues.get("feed-url") ?? "").trim();
    const id = String(readFlagString(parsed.flagValues, "id") ?? readFlagString(parsed.flagValues, "source-id") ?? "").trim();
    const weight = parseOptionalNumber(parsed.flagValues.get("weight"));
    const enabled = parseOptionalBoolean(parsed.flagValues.get("enabled"));

    if (!name || !category || !feedUrl) {
      throw new Error("source add 参数不足，示例: /topic source add --name \"OpenAI Blog\" --category engineering --url https://openai.com/blog/rss.xml");
    }

    return {
      kind: "sources_add",
      ...(profileId ? { profileId } : {}),
      payload: {
        ...(id ? { id } : {}),
        name,
        category,
        feedUrl,
        ...(weight === undefined ? {} : { weight }),
        ...(enabled === undefined ? {} : { enabled })
      }
    };
  }

  if (["update", "edit", "修改"].includes(op)) {
    const id = normalizeSourceId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "source-id")
      ?? ""
    );
    if (!id) {
      throw new Error("source update 需要 id，例如: /topic source update openai-blog --weight 1.3");
    }

    const patch: {
      name?: string;
      category?: TopicPushCategory;
      feedUrl?: string;
      weight?: number;
      enabled?: boolean;
    } = {};

    const name = String(parsed.flagValues.get("name") ?? parsed.flagValues.get("title") ?? "").trim();
    if (name) {
      patch.name = name;
    }

    const category = normalizeCategory(parsed.flagValues.get("category") ?? parsed.flagValues.get("cat") ?? "");
    if (category) {
      patch.category = category;
    }

    const url = String(parsed.flagValues.get("url") ?? parsed.flagValues.get("feed") ?? parsed.flagValues.get("feed-url") ?? "").trim();
    if (url) {
      patch.feedUrl = url;
    }

    const weight = parseOptionalNumber(parsed.flagValues.get("weight"));
    if (weight !== undefined) {
      patch.weight = weight;
    }

    const enabled = parseOptionalBoolean(parsed.flagValues.get("enabled"));
    if (enabled !== undefined) {
      patch.enabled = enabled;
    }

    if (Object.keys(patch).length === 0) {
      throw new Error("source update 需要至少一个变更字段（name/category/url/weight/enabled）");
    }

    return {
      kind: "sources_update",
      id,
      ...(profileId ? { profileId } : {}),
      patch
    };
  }

  throw new Error(`unknown source command: ${op}`);
}

function parseProfileCommand(tokens: string[]): ParsedCommand {
  if (tokens.length === 0) {
    return { kind: "profiles_list" };
  }

  const op = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const parsed = parseFlags(args);

  if (["list", "ls", "all", "列表"].includes(op)) {
    return { kind: "profiles_list" };
  }

  if (["get", "show", "详情"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    if (!id) {
      throw new Error("profile get 需要 id，例如: /topic profile get ai-engineering");
    }
    return { kind: "profiles_get", id };
  }

  if (["use", "switch", "activate", "切换"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    if (!id) {
      throw new Error("profile use 需要 id，例如: /topic profile use ai-engineering");
    }
    return { kind: "profiles_use", id };
  }

  if (["delete", "remove", "rm", "del", "删除"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    if (!id) {
      throw new Error("profile delete 需要 id，例如: /topic profile delete ai-engineering");
    }
    return { kind: "profiles_delete", id };
  }

  if (["add", "create", "新增"].includes(op)) {
    const name = normalizeText(readFlagString(parsed.flagValues, "name"));
    const id = normalizeText(readFlagString(parsed.flagValues, "id") ?? readFlagString(parsed.flagValues, "profile-id"));
    const cloneFrom = normalizeText(
      readFlagString(parsed.flagValues, "clone-from")
      ?? readFlagString(parsed.flagValues, "clone")
      ?? readFlagString(parsed.flagValues, "from")
    );
    if (!name) {
      throw new Error("profile add 参数不足，示例: /topic profile add --name \"AI 日报\" [--id ai-engineering]");
    }
    return {
      kind: "profiles_add",
      payload: {
        name,
        ...(id ? { id } : {}),
        ...(cloneFrom ? { cloneFrom } : {})
      }
    };
  }

  if (["update", "edit", "修改"].includes(op)) {
    const id = normalizeProfileId(
      parsed.positionals[0]
      ?? readFlagString(parsed.flagValues, "id")
      ?? readFlagString(parsed.flagValues, "profile-id")
      ?? ""
    );
    const name = normalizeText(readFlagString(parsed.flagValues, "name"));
    if (!id) {
      throw new Error("profile update 需要 id，例如: /topic profile update ai-engineering --name \"AI Digest\"");
    }
    if (!name) {
      throw new Error("profile update 目前仅支持 --name");
    }
    return {
      kind: "profiles_update",
      id,
      patch: {
        name
      }
    };
  }

  throw new Error(`unknown profile command: ${op}`);
}

function handleAddSource(payload: {
  id?: string;
  name: string;
  category: TopicPushCategory;
  feedUrl: string;
  weight?: number;
  enabled?: boolean;
}, profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const config = readConfig(profile.id);

  const source = normalizeSource(
    {
      id: payload.id,
      name: payload.name,
      category: payload.category,
      feedUrl: payload.feedUrl,
      weight: payload.weight,
      enabled: payload.enabled
    },
    config.sources.length
  );

  if (!source) {
    throw new Error("invalid source payload");
  }

  if (config.sources.some((item) => item.id === source.id)) {
    throw new Error(`source id already exists: ${source.id}`);
  }

  config.sources.push(source);
  writeConfig(config, profile.id);
  return `已新增 RSS 源: ${source.id} (${source.category}) [profile=${profile.id}]\n${source.name}\n${source.feedUrl}`;
}

function handleUpdateSource(
  id: string,
  patch: {
    name?: string;
    category?: TopicPushCategory;
    feedUrl?: string;
    weight?: number;
    enabled?: boolean;
  },
  profileId?: string
): string {
  const profile = getProfileMeta(profileId);
  const config = readConfig(profile.id);
  const index = config.sources.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new Error(`source not found: ${id}`);
  }

  const current = config.sources[index];
  const next: TopicPushSource = {
    ...current,
    ...(patch.name ? { name: patch.name.trim() } : {}),
    ...(patch.category ? { category: patch.category } : {}),
    ...(patch.feedUrl ? { feedUrl: normalizeFeedUrl(patch.feedUrl) } : {}),
    ...(typeof patch.weight === "number" ? { weight: clampWeight(patch.weight) } : {}),
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {})
  };

  if (!next.name) {
    throw new Error("source name cannot be empty");
  }
  if (!next.feedUrl) {
    throw new Error("source feedUrl cannot be empty");
  }

  config.sources[index] = next;
  writeConfig(config, profile.id);
  return `已更新 RSS 源: ${next.id} [profile=${profile.id}]\n${next.name}\n${next.feedUrl}`;
}

function handleDeleteSource(id: string, profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const config = readConfig(profile.id);
  const next = config.sources.filter((item) => item.id !== id);
  if (next.length === config.sources.length) {
    throw new Error(`source not found: ${id}`);
  }

  config.sources = next;
  writeConfig(config, profile.id);
  return `已删除 RSS 源: ${id} [profile=${profile.id}]`;
}

function handleToggleSource(id: string, enabled: boolean, profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const config = readConfig(profile.id);
  const source = config.sources.find((item) => item.id === id);
  if (!source) {
    throw new Error(`source not found: ${id}`);
  }

  source.enabled = enabled;
  writeConfig(config, profile.id);
  return `已${enabled ? "启用" : "停用"} RSS 源: ${source.id} [profile=${profile.id}]`;
}

function formatSingleSource(id: string, profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const config = readConfig(profile.id);
  const source = config.sources.find((item) => item.id === id);
  if (!source) {
    throw new Error(`source not found: ${id}`);
  }

  return [
    `profile: ${profile.id} (${profile.name})`,
    `RSS Source: ${source.id}`,
    `name: ${source.name}`,
    `category: ${source.category}`,
    `enabled: ${source.enabled ? "true" : "false"}`,
    `weight: ${source.weight.toFixed(2)}`,
    `feed_url: ${source.feedUrl}`
  ].join("\n");
}

function handleClearSentLog(profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const state = readState(profile.id);
  const size = state.sentLog.length;
  writeState({
    version: 1,
    sentLog: [],
    updatedAt: new Date().toISOString()
  }, profile.id);
  return `已清空 sent log，共删除 ${size} 条记录。[profile=${profile.id}]`;
}

function handleAddProfile(payload: { id?: string; name: string; cloneFrom?: string }): string {
  const configStore = readConfigStore();
  const stateStore = readStateStore();

  const name = normalizeText(payload.name);
  if (!name) {
    throw new Error("profile name cannot be empty");
  }

  const idRaw = payload.id ? payload.id : name;
  const id = normalizeProfileId(idRaw);
  if (!id) {
    throw new Error("invalid profile id");
  }

  if (configStore.profiles.some((item) => item.id === id)) {
    throw new Error(`profile already exists: ${id}`);
  }

  let baseConfig = cloneDefaultConfig();
  const cloneFromId = normalizeProfileId(payload.cloneFrom ?? "");
  if (cloneFromId) {
    const base = configStore.profiles.find((item) => item.id === cloneFromId);
    if (!base) {
      throw new Error(`cloneFrom profile not found: ${cloneFromId}`);
    }
    baseConfig = normalizeConfig(base.config);
  }

  configStore.profiles.push({
    id,
    name,
    config: baseConfig
  });
  stateStore.profiles.push({
    id,
    state: cloneDefaultState()
  });
  writeConfigStore(configStore);
  writeStateStore(stateStore);

  return `已新增 profile: ${id}\nname: ${name}\nclone_from: ${cloneFromId || "(default template)"}`;
}

function handleUpdateProfile(id: string, patch: { name?: string }): string {
  const normalizedId = normalizeProfileId(id);
  if (!normalizedId) {
    throw new Error("invalid profile id");
  }

  const configStore = readConfigStore();
  const profile = configStore.profiles.find((item) => item.id === normalizedId);
  if (!profile) {
    throw new Error(`profile not found: ${normalizedId}`);
  }

  const name = normalizeText(patch.name);
  if (!name) {
    throw new Error("profile update requires --name");
  }

  profile.name = name;
  writeConfigStore(configStore);
  return `已更新 profile: ${profile.id}\nname: ${profile.name}`;
}

function handleUseProfile(id: string): string {
  const normalizedId = normalizeProfileId(id);
  if (!normalizedId) {
    throw new Error("invalid profile id");
  }

  const configStore = readConfigStore();
  if (!configStore.profiles.some((item) => item.id === normalizedId)) {
    throw new Error(`profile not found: ${normalizedId}`);
  }

  configStore.activeProfileId = normalizedId;
  writeConfigStore(configStore);
  return `已切换 active profile: ${normalizedId}`;
}

function handleDeleteProfile(id: string): string {
  const normalizedId = normalizeProfileId(id);
  if (!normalizedId) {
    throw new Error("invalid profile id");
  }

  const configStore = readConfigStore();
  const stateStore = readStateStore();
  if (!configStore.profiles.some((item) => item.id === normalizedId)) {
    throw new Error(`profile not found: ${normalizedId}`);
  }
  if (configStore.profiles.length <= 1) {
    throw new Error("cannot delete the last profile");
  }

  configStore.profiles = configStore.profiles.filter((item) => item.id !== normalizedId);
  stateStore.profiles = stateStore.profiles.filter((item) => item.id !== normalizedId);
  if (configStore.activeProfileId === normalizedId) {
    configStore.activeProfileId = configStore.profiles[0].id;
  }

  writeConfigStore(configStore);
  writeStateStore(stateStore);

  return `已删除 profile: ${normalizedId}\nactive_profile: ${configStore.activeProfileId}`;
}

function formatProfiles(): string {
  const configStore = readConfigStore();
  const stateStore = readStateStore();
  const lines = [
    `Topic Push Profiles (${configStore.profiles.length})`,
    `active: ${configStore.activeProfileId}`
  ];

  for (const profile of configStore.profiles.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const state = stateStore.profiles.find((item) => item.id === profile.id)?.state ?? cloneDefaultState();
    const enabledCount = profile.config.sources.filter((item) => item.enabled).length;
    lines.push(
      `- ${profile.id}${profile.id === configStore.activeProfileId ? " *" : ""} | ${profile.name}`,
      `  sources=${enabledCount}/${profile.config.sources.length}, sent_log=${state.sentLog.length}`
    );
  }

  return lines.join("\n");
}

function formatSingleProfile(id: string): string {
  const profile = getProfileMeta(id);
  const state = readState(profile.id);
  return [
    `Topic Push Profile: ${profile.id}`,
    `name: ${profile.name}`,
    `active: ${profile.isActive ? "true" : "false"}`,
    `sources: ${profile.config.sources.length}`,
    `enabled_sources: ${profile.config.sources.filter((item) => item.enabled).length}`,
    `sent_log: ${state.sentLog.length}`
  ].join("\n");
}

function formatSources(sources: TopicPushSource[], profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const sorted = sources.slice().sort((left, right) => left.id.localeCompare(right.id));
  const enabledCount = sorted.filter((item) => item.enabled).length;

  const lines = [
    `profile: ${profile.id} (${profile.name})`,
    `Topic Push RSS Sources (${enabledCount}/${sorted.length} enabled)`
  ];

  if (sorted.length === 0) {
    lines.push("(empty)");
    return lines.join("\n");
  }

  for (const source of sorted) {
    lines.push(
      `- ${source.id} | ${source.category} | ${source.enabled ? "on" : "off"} | w=${source.weight.toFixed(2)} | ${source.name}`,
      `  ${source.feedUrl}`
    );
  }

  return lines.join("\n");
}

function formatConfig(config: TopicPushConfig, profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const topicStats = TOPIC_KEYS
    .map((key) => `${key}:${config.topics[key].length}`)
    .join(" ");

  return [
    "Topic Push Config",
    `profile: ${profile.id} (${profile.name})`,
    `summary_engine: ${config.summaryEngine}`,
    `default_language: ${config.defaultLanguage}`,
    `sources: ${config.sources.length} (enabled=${config.sources.filter((item) => item.enabled).length})`,
    `quota: total=${config.dailyQuota.total}, engineering=${config.dailyQuota.engineering}, news=${config.dailyQuota.news}, ecosystem=${config.dailyQuota.ecosystem}`,
    `filters: window=${config.filters.timeWindowHours}h, minTitleLength=${config.filters.minTitleLength}, maxPerDomain=${config.filters.maxPerDomain}`,
    `dedup: titleSimilarity=${config.filters.dedup.titleSimilarityThreshold.toFixed(2)}, urlNormalization=${config.filters.dedup.urlNormalization ? "on" : "off"}`,
    `blocked domains: ${config.filters.blockedDomains.join(", ") || "(none)"}`,
    `blocked title keywords: ${config.filters.blockedKeywordsInTitle.join(", ") || "(none)"}`,
    `topics: ${topicStats}`
  ].join("\n");
}

function formatState(state: TopicPushState, profileId?: string): string {
  const profile = getProfileMeta(profileId);
  const latest = state.sentLog[0];
  const latestText = latest
    ? `${formatLocalTime(latest.sentAt)} | ${latest.title} | ${latest.urlNormalized}`
    : "(none)";

  return [
    "Topic Push State",
    `profile: ${profile.id} (${profile.name})`,
    `sent_log_size: ${state.sentLog.length}`,
    `updated_at: ${state.updatedAt || "(empty)"}`,
    `latest: ${latestText}`
  ].join("\n");
}

function formatDigest(run: DigestRunResult, profile: { id: string; name: string }, targetLanguage: string): string {
  const language = normalizeDigestLanguage(targetLanguage);
  const summaryLabel = language === "en" ? "Summary" : "简述";
  const emptyText = language === "en"
    ? "No new items were selected today. Use /topic source list to check sources, or /topic state clear to reset dedup history."
    : "今天没有筛出新的可推送条目。可用 /topic source list 检查源状态，或 /topic state clear 清空去重历史后重试。";
  const lines: string[] = [];
  lines.push(`${profile.name} Daily Digest (${formatLocalDate(run.now)})`);

  if (run.selected.length === 0) {
    lines.push(`\n${emptyText}`);
    return lines.join("\n");
  }

  for (const item of run.selected) {
    const cleanTitle = sanitizeDigestTitle(item.candidate.title, 180) || item.candidate.title;
    lines.push("");
    lines.push(`${item.rank}. ${cleanTitle}`);
    if (item.digestType === "deep_read" && item.digestSummary) {
      lines.push(`   ${summaryLabel}: ${item.digestSummary}`);
    }
    lines.push(`   ${item.candidate.url}`);
  }

  return lines.join("\n");
}

function buildHelpText(): string {
  return [
    "Topic Push 用法",
    "- /topic 或 /topic run [--profile <id>] [--lang <zh-CN|en>]: 拉取 RSS 并生成该实体当日简报",
    "- /topic profile list|get|add|update|use|delete: 管理分组实体（profile）",
    "- /topic profile add --name \"AI Daily\" [--id ai-daily] [--clone-from ai-engineering]",
    "- /topic profile use <id>: 切换默认实体",
    "- /topic source list [--profile <id>]: 查看 RSS 源",
    "- /topic source get <id> [--profile <id>]: 查看单个源",
    "- /topic source add --name \"OpenAI Blog\" --category engineering --url https://openai.com/blog/rss.xml [--id openai-blog] [--weight 1.2] [--enabled true] [--profile <id>]",
    "- /topic source update <id> --name ... --category ... --url ... --weight ... --enabled true|false [--profile <id>]",
    "- /topic source enable <id> / disable <id> [--profile <id>]",
    "- /topic source delete <id> [--profile <id>]",
    "- /topic config [--profile <id>]: 查看筛选与配额配置",
    "- /topic state [--profile <id>]: 查看 sent log 状态",
    "- /topic state clear [--profile <id>]: 清空 sent log（允许重复推送历史链接）"
  ].join("\n");
}

function normalizeConfigStore(input: unknown): TopicPushConfigStore {
  const source = asRecord(input);
  if (!source || !Array.isArray(source.profiles)) {
    return {
      version: 2,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          config: normalizeConfig(input)
        }
      ]
    };
  }

  const normalizedProfilesRaw = toArray(source.profiles)
    .map((item, index) => normalizeConfigProfile(item, index))
    .filter((item): item is TopicPushProfileConfig => Boolean(item));
  const normalizedProfiles: TopicPushProfileConfig[] = [];
  const idSet = new Set<string>();
  for (const profile of normalizedProfilesRaw) {
    if (idSet.has(profile.id)) {
      continue;
    }
    idSet.add(profile.id);
    normalizedProfiles.push(profile);
  }

  if (normalizedProfiles.length === 0) {
    return cloneDefaultConfigStore();
  }

  const activeRaw = normalizeProfileId(source.activeProfileId);
  const activeProfileId = activeRaw && normalizedProfiles.some((item) => item.id === activeRaw)
    ? activeRaw
    : normalizedProfiles[0].id;

  return {
    version: 2,
    activeProfileId,
    profiles: normalizedProfiles
  };
}

function normalizeConfigProfile(input: unknown, index: number): TopicPushProfileConfig | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const name = normalizeText(source.name);
  const idRaw = normalizeText(source.id) || name || `profile-${index + 1}`;
  const id = normalizeProfileId(idRaw);
  if (!id) {
    return null;
  }

  const config = normalizeConfig(source.config ?? source);
  return {
    id,
    name: name || `Profile ${index + 1}`,
    config
  };
}

function normalizeStateStore(input: unknown): TopicPushStateStore {
  const source = asRecord(input);
  if (!source || !Array.isArray(source.profiles)) {
    return {
      version: 2,
      profiles: [
        {
          id: DEFAULT_PROFILE_ID,
          state: normalizeState(input)
        }
      ]
    };
  }

  const normalizedProfilesRaw = toArray(source.profiles)
    .map((item, index) => normalizeStateProfile(item, index))
    .filter((item): item is TopicPushProfileState => Boolean(item));
  const normalizedProfiles: TopicPushProfileState[] = [];
  const idSet = new Set<string>();
  for (const profile of normalizedProfilesRaw) {
    if (idSet.has(profile.id)) {
      continue;
    }
    idSet.add(profile.id);
    normalizedProfiles.push(profile);
  }

  if (normalizedProfiles.length === 0) {
    return cloneDefaultStateStore();
  }

  return {
    version: 2,
    profiles: normalizedProfiles
  };
}

function normalizeStateProfile(input: unknown, index: number): TopicPushProfileState | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const idRaw = normalizeText(source.id) || `profile-${index + 1}`;
  const id = normalizeProfileId(idRaw);
  if (!id) {
    return null;
  }

  return {
    id,
    state: normalizeState(source.state ?? source)
  };
}

function normalizeConfig(input: unknown): TopicPushConfig {
  const source = asRecord(input);
  if (!source) {
    return cloneDefaultConfig();
  }

  const summaryEngine = normalizeSummaryEngine(
    source.summaryEngine
    ?? source.summary_engine
    ?? source.analysisEngine
    ?? source.engine
  );
  const defaultLanguage = normalizeConfigDigestLanguage(
    source.defaultLanguage
    ?? source.default_language
    ?? source.language
  );
  const normalizedSources = normalizeSources(source.sources);
  const normalizedTopics = normalizeTopics(source.topics);
  const normalizedFilters = normalizeFilters(source.filters);
  const normalizedQuota = normalizeDailyQuota(source.dailyQuota);

  return {
    version: 1,
    summaryEngine,
    defaultLanguage,
    sources: normalizedSources,
    topics: normalizedTopics,
    filters: normalizedFilters,
    dailyQuota: normalizedQuota
  };
}

function normalizeSources(input: unknown): TopicPushSource[] {
  const rows = toArray(input);
  const out: TopicPushSource[] = [];
  const idSet = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const source = normalizeSource(rows[i], i);
    if (!source) {
      continue;
    }
    if (idSet.has(source.id)) {
      continue;
    }
    idSet.add(source.id);
    out.push(source);
  }

  if (out.length === 0) {
    return DEFAULT_SOURCES.map((item) => ({ ...item }));
  }

  return out;
}

function normalizeSource(input: unknown, index: number): TopicPushSource | null {
  const source = asRecord(input);
  if (!source) {
    return null;
  }

  const name = normalizeText(source.name);
  const category = normalizeCategory(source.category);
  const feedUrlRaw = normalizeText(source.feedUrl ?? source.feed_url ?? source.url);
  if (!name || !category || !feedUrlRaw) {
    return null;
  }

  const idRaw = normalizeText(source.id) || buildSourceId(name, feedUrlRaw, index);
  const id = normalizeSourceId(idRaw);
  if (!id) {
    return null;
  }

  const feedUrl = normalizeFeedUrl(feedUrlRaw);
  if (!feedUrl) {
    return null;
  }

  if (shouldDropLegacySource(id, feedUrl)) {
    return null;
  }

  const migratedFeedUrl = migrateLegacyFeedUrl(feedUrl);
  const enabled = parseOptionalBoolean(source.enabled) ?? true;

  return {
    id,
    name,
    category,
    feedUrl: migratedFeedUrl,
    weight: clampWeight(Number(source.weight)),
    enabled
  };
}

function normalizeTopics(input: unknown): Record<TopicKey, string[]> {
  const source = asRecord(input);
  const out = createDefaultTopics();

  if (!source) {
    return out;
  }

  for (const key of TOPIC_KEYS) {
    const list = toArray(source[key])
      .map((item) => normalizeText(item))
      .filter((item): item is string => Boolean(item));

    const unique = Array.from(new Set(list));
    if (unique.length > 0) {
      out[key] = unique;
    }
  }

  return out;
}

function normalizeFilters(input: unknown): TopicPushFilters {
  const source = asRecord(input);
  const fallback = DEFAULT_CONFIG.filters;
  if (!source) {
    return {
      ...fallback,
      blockedDomains: fallback.blockedDomains.slice(),
      blockedKeywordsInTitle: fallback.blockedKeywordsInTitle.slice(),
      dedup: {
        ...fallback.dedup
      }
    };
  }

  const dedup = asRecord(source.dedup);

  const blockedDomains = toArray(source.blockedDomains)
    .map((item) => normalizeText(item).toLowerCase())
    .filter((item): item is string => Boolean(item));

  const blockedKeywords = toArray(source.blockedKeywordsInTitle)
    .map((item) => normalizeText(item).toLowerCase())
    .filter((item): item is string => Boolean(item));

  return {
    timeWindowHours: clampInteger(source.timeWindowHours, 24, 1, 168),
    minTitleLength: clampInteger(source.minTitleLength, 8, 1, 80),
    blockedDomains,
    blockedKeywordsInTitle: blockedKeywords,
    maxPerDomain: clampInteger(source.maxPerDomain, 2, 1, 10),
    dedup: {
      titleSimilarityThreshold: clampNumber(dedup?.titleSimilarityThreshold, 0.9, 0.5, 1),
      urlNormalization: parseOptionalBoolean(dedup?.urlNormalization) ?? true
    }
  };
}

function normalizeDailyQuota(input: unknown): TopicPushDailyQuota {
  const source = asRecord(input);
  const fallback = DEFAULT_CONFIG.dailyQuota;
  if (!source) {
    return { ...fallback };
  }

  const normalized = {
    total: clampInteger(source.total, fallback.total, 1, 40),
    engineering: clampInteger(source.engineering, fallback.engineering, 0, 40),
    news: clampInteger(source.news, fallback.news, 0, 40),
    ecosystem: clampInteger(source.ecosystem, fallback.ecosystem, 0, 40)
  };
  return migrateLegacyDailyQuota(normalized);
}

function migrateLegacyDailyQuota(quota: TopicPushDailyQuota): TopicPushDailyQuota {
  if (
    quota.total === LEGACY_DAILY_QUOTA.total
    && quota.engineering === LEGACY_DAILY_QUOTA.engineering
    && quota.news === LEGACY_DAILY_QUOTA.news
    && quota.ecosystem === LEGACY_DAILY_QUOTA.ecosystem
  ) {
    return { ...DEFAULT_CONFIG.dailyQuota };
  }
  return quota;
}

function normalizeState(input: unknown): TopicPushState {
  const source = asRecord(input);
  if (!source) {
    return {
      version: 1,
      sentLog: [],
      updatedAt: ""
    };
  }

  const sentLog = toArray(source.sentLog)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      urlNormalized: normalizeText(item.urlNormalized),
      sentAt: parseDateToIso(item.sentAt) ?? "",
      title: normalizeText(item.title)
    }))
    .filter((item) => Boolean(item.urlNormalized && item.sentAt));

  sentLog.sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt));

  return {
    version: 1,
    sentLog: sentLog.slice(0, SENT_LOG_MAX_ITEMS),
    updatedAt: parseDateToIso(source.updatedAt) ?? ""
  };
}

function detectTopicTags(
  title: string,
  summary: string,
  topics: Record<TopicKey, string[]>
): TopicKey[] {
  const haystack = `${title}\n${summary}`.toLowerCase();
  const tags: TopicKey[] = [];

  for (const key of TOPIC_KEYS) {
    const keywords = topics[key] ?? [];
    if (keywords.some((keyword) => keyword && haystack.includes(keyword.toLowerCase()))) {
      tags.push(key);
    }
  }

  return tags;
}

function scoreCandidate(input: {
  title: string;
  summary: string;
  topicTags: TopicKey[];
  publishedAt: string | null;
  lang: "zh" | "en" | "unknown";
  sourceWeight: number;
  now: Date;
}): number {
  let base = 1.0;

  if (input.publishedAt) {
    const diffHours = (input.now.getTime() - Date.parse(input.publishedAt)) / 3600000;
    if (Number.isFinite(diffHours) && diffHours <= 6) {
      base += 1.0;
    } else if (Number.isFinite(diffHours) && diffHours <= 24) {
      base += 0.5;
    }
  } else {
    base -= 0.2;
  }

  if (input.topicTags.length > 0) {
    base += Math.min(0.8, 0.3 * input.topicTags.length);
  }

  const lowerTitle = input.title.toLowerCase();
  const engineeringSignal = ENGINEERING_SIGNAL_KEYWORDS.some((keyword) => lowerTitle.includes(keyword));
  if (engineeringSignal) {
    base += 0.2;
  }

  if (input.lang === "unknown") {
    base -= 0.1;
  }

  const weight = clampWeight(input.sourceWeight);
  const jitter = buildDeterministicJitter(`${input.title}\n${input.summary}`);

  return base * weight + jitter;
}

function isBetterCandidate(left: Candidate, right: Candidate): boolean {
  if (left.score !== right.score) {
    return left.score > right.score;
  }

  const leftPublished = left.publishedAt ? Date.parse(left.publishedAt) : 0;
  const rightPublished = right.publishedAt ? Date.parse(right.publishedAt) : 0;
  if (leftPublished !== rightPublished) {
    return leftPublished > rightPublished;
  }

  return left.fetchedAt > right.fetchedAt;
}

function buildDeterministicJitter(seed: string): number {
  const hash = buildStableHash(seed);
  const chunk = Number.parseInt(hash.slice(0, 6), 16);
  if (!Number.isFinite(chunk)) {
    return 0;
  }
  return ((chunk % 61) - 30) / 1000;
}

function firstSentence(text: string): string {
  const plain = normalizeSummary(text);
  if (!plain) {
    return "";
  }

  const match = plain.match(/^(.{20,180}?[。！？!?\.])/);
  const sentence = match?.[1] ?? plain;
  return clampText(sentence, 120);
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeForSimilarity(left);
  const rightTokens = tokenizeForSimilarity(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    const normalizedLeft = normalizeTitle(left);
    const normalizedRight = normalizeTitle(right);
    return normalizedLeft && normalizedLeft === normalizedRight ? 1 : 0;
  }

  let intersect = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersect += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersect;
  if (union <= 0) {
    return 0;
  }
  return intersect / union;
}

function tokenizeForSimilarity(title: string): Set<string> {
  const normalized = normalizeTitle(title).toLowerCase();
  if (!normalized) {
    return new Set<string>();
  }

  const parts = normalized
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  return new Set(parts);
}

function detectLang(text: string): "zh" | "en" | "unknown" {
  const value = normalizeText(text);
  if (!value) {
    return "unknown";
  }

  if (/[\u4e00-\u9fff]/.test(value)) {
    return "zh";
  }

  if (/[a-zA-Z]/.test(value)) {
    return "en";
  }

  return "unknown";
}

function normalizeUrl(rawUrl: string): string {
  const raw = normalizeText(rawUrl);
  if (!raw) {
    return "";
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (url.protocol === "http:") {
    url.protocol = "https:";
  }

  url.hash = "";

  const normalizedParams = new URLSearchParams();
  const sorted = Array.from(url.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of sorted) {
    const keyLower = key.toLowerCase();
    if (keyLower.startsWith("utm_")) {
      continue;
    }
    if (TRACKING_QUERY_PARAMS.has(keyLower)) {
      continue;
    }
    normalizedParams.append(key, value);
  }

  const query = normalizedParams.toString();
  url.search = query ? `?${query}` : "";

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/g, "");
  }

  return url.toString();
}

function normalizeFeedUrl(rawUrl: string): string {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    if (!parsed.protocol.startsWith("http")) {
      return "";
    }
  } catch {
    return "";
  }

  return normalized;
}

function migrateLegacyFeedUrl(feedUrl: string): string {
  const key = feedUrl.toLowerCase();
  const migrated = LEGACY_FEED_URL_MIGRATION[key];
  if (!migrated) {
    return feedUrl;
  }
  return normalizeFeedUrl(migrated) || feedUrl;
}

function shouldDropLegacySource(id: string, feedUrl: string): boolean {
  const key = feedUrl.toLowerCase();
  if (id !== "anthropic-news") {
    return false;
  }
  return LEGACY_FEED_DISABLE_LIST.has(key);
}

function isDomainBlocked(domain: string, blocked: string[]): boolean {
  const normalized = domain.toLowerCase();
  return blocked.some((item) => normalized === item || normalized.endsWith(`.${item}`));
}

function extractDomain(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function parseDateToIso(raw: unknown): string | null {
  const value = normalizeText(raw);
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }

  return new Date(ms).toISOString();
}

function extractLink(raw: unknown): string {
  if (typeof raw === "string") {
    return normalizeText(raw);
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const link = extractLink(item);
      if (link) {
        return link;
      }
    }
    return "";
  }

  const source = asRecord(raw);
  if (!source) {
    return "";
  }

  const href = normalizeText(source["@_href"] ?? source.href ?? source["#text"] ?? source["$text"]);
  if (href) {
    return href;
  }

  return "";
}

function extractAtomLink(raw: unknown): string {
  if (typeof raw === "string") {
    return normalizeText(raw);
  }

  const entries = toArray(raw)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  for (const entry of entries) {
    const rel = normalizeText(entry["@_rel"] ?? entry.rel).toLowerCase();
    const href = normalizeText(entry["@_href"] ?? entry.href ?? entry["#text"]);
    if (!href) {
      continue;
    }
    if (!rel || rel === "alternate" || rel === "self") {
      return href;
    }
  }

  for (const entry of entries) {
    const href = normalizeText(entry["@_href"] ?? entry.href ?? entry["#text"]);
    if (href) {
      return href;
    }
  }

  return "";
}

function toText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = toText(item);
      if (text) {
        return text;
      }
    }
    return "";
  }

  const source = asRecord(value);
  if (!source) {
    return "";
  }

  const candidates: unknown[] = [
    source["#text"],
    source["$text"],
    source["__cdata"],
    source["@_value"],
    source.value,
    source.href,
    source["@_href"]
  ];

  for (const item of candidates) {
    const text = toText(item);
    if (text) {
      return text;
    }
  }

  return "";
}

function stripFeedMetadataNoise(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .replace(/comments?\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/comments?\s*url\s*:\s*(?=(?:points?|#\s*comments?|comments?)\s*:|$)/gi, " ")
    .replace(/#\s*comments?\s*:\s*\d+\b/gi, " ")
    .replace(/\bcomments?\s*:\s*\d+\b/gi, " ")
    .replace(/\bpoints?\s*:\s*\d+\b/gi, " ");
}

function normalizeSummary(text: string): string {
  if (!text) {
    return "";
  }

  const withoutTags = stripFeedMetadataNoise(text)
    .replace(/<!\[CDATA\[|\]\]>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/article\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/source\s*url\s*:\s*https?:\/\/\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clampText(withoutTags, 280);
}

function normalizeTitle(text: string): string {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function clampText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function buildStableHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function normalizeSourceId(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized;
}

function normalizeProfileId(raw: unknown): string {
  const normalized = normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized;
}

function buildSourceId(name: string, feedUrl: string, index: number): string {
  const fromName = normalizeSourceId(name);
  if (fromName) {
    return fromName;
  }

  const domain = extractDomain(feedUrl);
  if (domain) {
    return normalizeSourceId(domain);
  }

  return `source-${index + 1}`;
}

function normalizeCategory(raw: unknown): TopicPushCategory | null {
  const value = normalizeText(raw).toLowerCase();
  if (!value) {
    return null;
  }

  if (["engineering", "eng", "工程"].includes(value)) {
    return "engineering";
  }
  if (["news", "新闻"].includes(value)) {
    return "news";
  }
  if (["ecosystem", "eco", "生态"].includes(value)) {
    return "ecosystem";
  }

  return null;
}

function formatLocalDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return iso;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return iso;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function clampInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clampWeight(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 1;
  }
  if (raw < 0.1) {
    return 0.1;
  }
  if (raw > 5) {
    return 5;
  }
  return Math.round(raw * 100) / 100;
}

function normalizeQuotaNumber(raw: unknown, fallback: number): number {
  return clampInteger(raw, fallback, 0, 40);
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseFlags(tokens: string[]): { positionals: string[]; flagValues: Map<string, string | true> } {
  const positionals: string[] = [];
  const flagValues = new Map<string, string | true>();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    if (!body) {
      continue;
    }

    const eqIndex = body.indexOf("=");
    if (eqIndex >= 0) {
      const key = body.slice(0, eqIndex).trim().toLowerCase();
      const value = body.slice(eqIndex + 1).trim();
      if (key) {
        flagValues.set(key, value || true);
      }
      continue;
    }

    const key = body.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const next = tokens[i + 1];
    if (!next || next.startsWith("--")) {
      flagValues.set(key, true);
      continue;
    }

    flagValues.set(key, next);
    i += 1;
  }

  return { positionals, flagValues };
}

function readFlagString(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function readProfileId(flags: Map<string, string | true>, positional?: string): string | undefined {
  const raw = readFlagString(flags, "profile")
    ?? readFlagString(flags, "profile-id")
    ?? positional
    ?? "";
  const normalized = normalizeProfileId(raw);
  return normalized || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function cloneDefaultConfig(): TopicPushConfig {
  return {
    version: 1,
    summaryEngine: DEFAULT_CONFIG.summaryEngine,
    defaultLanguage: DEFAULT_CONFIG.defaultLanguage,
    sources: DEFAULT_SOURCES.map((item) => ({ ...item })),
    topics: createDefaultTopics(),
    filters: {
      timeWindowHours: DEFAULT_CONFIG.filters.timeWindowHours,
      minTitleLength: DEFAULT_CONFIG.filters.minTitleLength,
      blockedDomains: DEFAULT_CONFIG.filters.blockedDomains.slice(),
      blockedKeywordsInTitle: DEFAULT_CONFIG.filters.blockedKeywordsInTitle.slice(),
      maxPerDomain: DEFAULT_CONFIG.filters.maxPerDomain,
      dedup: {
        titleSimilarityThreshold: DEFAULT_CONFIG.filters.dedup.titleSimilarityThreshold,
        urlNormalization: DEFAULT_CONFIG.filters.dedup.urlNormalization
      }
    },
    dailyQuota: { ...DEFAULT_CONFIG.dailyQuota }
  };
}

function cloneDefaultState(): TopicPushState {
  return {
    version: 1,
    sentLog: [],
    updatedAt: ""
  };
}

function cloneDefaultConfigStore(): TopicPushConfigStore {
  return {
    version: 2,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        config: cloneDefaultConfig()
      }
    ]
  };
}

function cloneDefaultStateStore(): TopicPushStateStore {
  return {
    version: 2,
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        state: cloneDefaultState()
      }
    ]
  };
}

function createDefaultTopics(): Record<TopicKey, string[]> {
  return {
    llm_apps: DEFAULT_TOPIC_KEYWORDS.llm_apps.slice(),
    agents: DEFAULT_TOPIC_KEYWORDS.agents.slice(),
    multimodal: DEFAULT_TOPIC_KEYWORDS.multimodal.slice(),
    reasoning: DEFAULT_TOPIC_KEYWORDS.reasoning.slice(),
    rag: DEFAULT_TOPIC_KEYWORDS.rag.slice(),
    eval: DEFAULT_TOPIC_KEYWORDS.eval.slice(),
    on_device: DEFAULT_TOPIC_KEYWORDS.on_device.slice(),
    safety: DEFAULT_TOPIC_KEYWORDS.safety.slice()
  };
}
