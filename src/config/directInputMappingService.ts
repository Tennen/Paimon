import {
  DATA_STORE,
  DataStoreDescriptor,
  getStore,
  registerStore,
  setStore
} from "../storage/persistence";

const DIRECT_INPUT_MAPPING_STORE = DATA_STORE.DIRECT_INPUT_MAPPINGS;
const MAX_RULES = 100;

export type DirectInputMatchMode = "exact" | "fuzzy";

export type DirectInputMappingRule = {
  id: string;
  name: string;
  pattern: string;
  targetText: string;
  matchMode: DirectInputMatchMode;
  enabled: boolean;
};

export type DirectInputMappingConfig = {
  version: 1;
  rules: DirectInputMappingRule[];
  updatedAt: string;
};

export type DirectInputMappingSnapshot = {
  config: DirectInputMappingConfig;
  store: DataStoreDescriptor;
};

export type ResolvedDirectInputMapping = {
  ruleId: string;
  ruleName?: string;
  pattern: string;
  matchMode: DirectInputMatchMode;
  targetText: string;
};

export class DirectInputMappingService {
  private readonly storeName = DIRECT_INPUT_MAPPING_STORE;
  private readonly store: DataStoreDescriptor;

  constructor() {
    this.store = registerStore(this.storeName, () => ({
      version: 1,
      rules: [],
      updatedAt: ""
    }));
  }

  getSnapshot(): DirectInputMappingSnapshot {
    return {
      config: this.readConfig(),
      store: this.store
    };
  }

  saveConfig(input: unknown): DirectInputMappingSnapshot {
    const next = normalizeDirectInputMappingConfig(input);
    setStore(this.storeName, next);
    return {
      config: next,
      store: this.store
    };
  }

  resolveInput(input: string): ResolvedDirectInputMapping | null {
    return resolveDirectInputMapping(input, this.readConfig());
  }

  private readConfig(): DirectInputMappingConfig {
    return normalizeDirectInputMappingConfig(getStore<unknown>(this.storeName));
  }
}

export function resolveDirectInputMapping(
  input: string,
  config: DirectInputMappingConfig
): ResolvedDirectInputMapping | null {
  const rawInput = String(input ?? "").trim();
  if (!rawInput || rawInput.startsWith("/")) {
    return null;
  }

  const normalizedInput = normalizeMatchText(rawInput);
  if (!normalizedInput) {
    return null;
  }

  const rules = normalizeDirectInputMappingConfig(config).rules
    .filter((item) => item.enabled && item.pattern && item.targetText);

  const exact = rules.find((rule) => {
    return rule.matchMode === "exact" && normalizeMatchText(rule.pattern) === normalizedInput;
  });
  if (exact) {
    return toResolvedRule(exact);
  }

  const fuzzy = rules.find((rule) => {
    const normalizedPattern = normalizeMatchText(rule.pattern);
    return rule.matchMode === "fuzzy" && normalizedPattern && normalizedInput.includes(normalizedPattern);
  });
  if (fuzzy) {
    return toResolvedRule(fuzzy);
  }

  return null;
}

export function normalizeDirectInputMappingConfig(input: unknown): DirectInputMappingConfig {
  const source = input && typeof input === "object"
    ? input as Partial<DirectInputMappingConfig>
    : null;
  const rawRules = Array.isArray(source?.rules) ? source.rules : [];
  const rules: DirectInputMappingRule[] = [];
  const idSet = new Set<string>();

  for (let i = 0; i < rawRules.length && rules.length < MAX_RULES; i += 1) {
    const normalized = normalizeDirectInputMappingRule(rawRules[i], i);
    if (idSet.has(normalized.id)) {
      continue;
    }
    idSet.add(normalized.id);
    rules.push(normalized);
  }

  return {
    version: 1,
    rules,
    updatedAt: String(source?.updatedAt ?? "").trim() || new Date().toISOString()
  };
}

function normalizeDirectInputMappingRule(
  input: unknown,
  index: number
): DirectInputMappingRule {
  const source = input && typeof input === "object"
    ? input as Partial<DirectInputMappingRule>
    : null;
  return {
    id: normalizeRuleId(String(source?.id ?? `mapping-${index + 1}`), `mapping-${index + 1}`),
    name: String(source?.name ?? "").trim(),
    pattern: String(source?.pattern ?? "").trim(),
    targetText: String(source?.targetText ?? "").trim(),
    matchMode: normalizeMatchMode(source?.matchMode),
    enabled: typeof source?.enabled === "boolean" ? source.enabled : true
  };
}

function normalizeRuleId(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeMatchMode(raw: unknown): DirectInputMatchMode {
  return raw === "fuzzy" ? "fuzzy" : "exact";
}

function normalizeMatchText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toResolvedRule(rule: DirectInputMappingRule): ResolvedDirectInputMapping {
  return {
    ruleId: rule.id,
    ...(rule.name ? { ruleName: rule.name } : {}),
    pattern: rule.pattern,
    matchMode: rule.matchMode,
    targetText: rule.targetText
  };
}
