import { DATA_STORE } from "../../storage/persistence";
import {
  TopicKey,
  TopicPushConfig,
  TopicPushConfigStore,
  TopicPushSource,
  TopicPushState,
  TopicPushStateStore
} from "./types";

export const TOPIC_KEYS: TopicKey[] = [
  "llm_apps",
  "agents",
  "multimodal",
  "reasoning",
  "rag",
  "eval",
  "on_device",
  "safety"
];

export const TRACKING_QUERY_PARAMS = new Set([
  "ref",
  "ref_src",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "spm"
]);

export const ENGINEERING_SIGNAL_KEYWORDS = [
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

export const SENT_LOG_RETENTION_DAYS = 120;
export const SENT_LOG_MAX_ITEMS = 5000;
export const FEED_FETCH_TIMEOUT_MS = 12000;
export const DEFAULT_PROFILE_ID = "ai-engineering";
export const DEFAULT_PROFILE_NAME = "AI Engineering";
export const LEGACY_DAILY_QUOTA = {
  total: 10,
  engineering: 7,
  news: 2,
  ecosystem: 1
} as const;
export const DEFAULT_TARGET_LANGUAGE = "zh-CN";

export const TOPIC_PUSH_CONFIG_STORE = DATA_STORE.TOPIC_PUSH_CONFIG;
export const TOPIC_PUSH_STATE_STORE = DATA_STORE.TOPIC_PUSH_STATE;
export const LEGACY_FEED_URL_MIGRATION: Record<string, string> = {
  "https://eng.uber.com/feed": "https://www.uber.com/blog/engineering/feed/",
  "https://eng.uber.com/feed/": "https://www.uber.com/blog/engineering/feed/",
  "https://www.interconnects.ai/rss": "https://www.interconnects.ai/feed",
  "https://www.interconnects.ai/rss/": "https://www.interconnects.ai/feed"
};
export const LEGACY_FEED_DISABLE_LIST = new Set([
  "https://www.anthropic.com/news/rss",
  "https://www.anthropic.com/news/rss.xml"
]);

export const DEFAULT_SOURCES: TopicPushSource[] = [
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

export const DEFAULT_TOPIC_KEYWORDS: Record<TopicKey, string[]> = {
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

export const DEFAULT_CONFIG: TopicPushConfig = {
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

export const DEFAULT_STATE: TopicPushState = {
  version: 1,
  sentLog: [],
  updatedAt: ""
};

export const DEFAULT_CONFIG_STORE: TopicPushConfigStore = {
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

export const DEFAULT_STATE_STORE: TopicPushStateStore = {
  version: 2,
  profiles: [
    {
      id: DEFAULT_PROFILE_ID,
      state: DEFAULT_STATE
    }
  ]
};

export function createDefaultTopics(): Record<TopicKey, string[]> {
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

export function cloneDefaultConfig(): TopicPushConfig {
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

export function cloneDefaultState(): TopicPushState {
  return {
    version: 1,
    sentLog: [],
    updatedAt: ""
  };
}

export function cloneDefaultConfigStore(): TopicPushConfigStore {
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

export function cloneDefaultStateStore(): TopicPushStateStore {
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
