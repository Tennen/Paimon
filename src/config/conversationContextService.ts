import {
  DATA_STORE,
  DataStoreDescriptor,
  getStore,
  registerStore,
  setStore
} from "../storage/persistence";

const CONVERSATION_CONTEXT_STORE = DATA_STORE.CONVERSATION_CONTEXT;
const MAX_SELECTION_COUNT = 200;

export type ConversationContextConfig = {
  version: 1;
  selectedSkillNames: string[] | null;
  selectedToolNames: string[] | null;
  updatedAt: string;
};

export type ConversationContextSnapshot = {
  config: ConversationContextConfig;
  store: DataStoreDescriptor;
};

export class ConversationContextService {
  private readonly storeName = CONVERSATION_CONTEXT_STORE;
  private readonly store: DataStoreDescriptor;

  constructor() {
    this.store = registerStore(this.storeName, () => ({
      version: 1,
      selectedSkillNames: null,
      selectedToolNames: null,
      updatedAt: ""
    }));
  }

  getSnapshot(): ConversationContextSnapshot {
    return {
      config: this.readConfig(),
      store: this.store
    };
  }

  saveConfig(
    input: unknown,
    options: {
      availableSkillNames?: string[];
      availableToolNames?: string[];
    } = {}
  ): ConversationContextSnapshot {
    const next = normalizeConversationContextConfig(input, options);
    setStore(this.storeName, next);
    return {
      config: next,
      store: this.store
    };
  }

  getSelectedSkillNames(): string[] | null {
    return this.readConfig().selectedSkillNames;
  }

  getSelectedToolNames(): string[] | null {
    return this.readConfig().selectedToolNames;
  }

  private readConfig(): ConversationContextConfig {
    return normalizeConversationContextConfig(getStore<unknown>(this.storeName));
  }
}

export function normalizeConversationContextConfig(
  input: unknown,
  options: {
    availableSkillNames?: string[];
    availableToolNames?: string[];
  } = {}
): ConversationContextConfig {
  const source = input && typeof input === "object"
    ? input as Partial<ConversationContextConfig>
    : null;

  return {
    version: 1,
    selectedSkillNames: normalizeSelectionList(source?.selectedSkillNames, options.availableSkillNames),
    selectedToolNames: normalizeSelectionList(source?.selectedToolNames, options.availableToolNames),
    updatedAt: String(source?.updatedAt ?? "").trim() || new Date().toISOString()
  };
}

function normalizeSelectionList(input: unknown, availableNames?: string[]): string[] | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (!Array.isArray(input)) {
    return null;
  }

  const allowed = Array.isArray(availableNames)
    ? new Set(availableNames.map((item) => String(item ?? "").trim()).filter(Boolean))
    : null;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of input) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    if (allowed && !allowed.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= MAX_SELECTION_COUNT) {
      break;
    }
  }

  return result;
}
