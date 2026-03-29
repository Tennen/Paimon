import fs from "fs";
import path from "path";
import { getStore, registerStore, resolveDataPath, setStore } from "../../storage/persistence";
import {
  cloneDefaultConfigStore,
  cloneDefaultState,
  cloneDefaultStateStore,
  TOPIC_SUMMARY_CONFIG_STORE,
  TOPIC_SUMMARY_STATE_STORE
} from "./defaults";
import { normalizeProfileId } from "./shared";
import {
  TopicSummaryConfig,
  TopicSummaryConfigStore,
  TopicSummaryProfileConfig,
  TopicSummaryProfileMeta,
  TopicSummaryProfileSnapshot,
  TopicSummarySnapshot,
  TopicSummaryState,
  TopicSummaryStateStore
} from "./types";
import {
  normalizeConfig,
  normalizeState,
  normalizeConfigStore as normalizeConfigStoreValue,
  normalizeStateStore as normalizeStateStoreValue
} from "./storage_normalize";
export {
  normalizeConfig,
  normalizeConfigDigestLanguage,
  normalizeSource,
  normalizeState,
  normalizeSummaryEngine
} from "./storage_normalize";

export function ensureTopicSummaryStorage(): void {
  migrateLegacyTopicSummaryStoreFiles();
  registerStore(TOPIC_SUMMARY_CONFIG_STORE, () => DEFAULT_CONFIG_STORE_PROXY());
  registerStore(TOPIC_SUMMARY_STATE_STORE, () => DEFAULT_STATE_STORE_PROXY());
}

let legacyTopicSummaryStoreMigrated = false;

function migrateLegacyTopicSummaryStoreFiles(): void {
  if (legacyTopicSummaryStoreMigrated) {
    return;
  }
  legacyTopicSummaryStoreMigrated = true;

  migrateLegacyStoreFile("topic-push/config.json", "topic-summary/config.json");
  migrateLegacyStoreFile("topic-push/state.json", "topic-summary/state.json");
}

function migrateLegacyStoreFile(legacyRelativePath: string, nextRelativePath: string): void {
  const legacyPath = resolveDataPath(legacyRelativePath);
  const nextPath = resolveDataPath(nextRelativePath);
  if (!fs.existsSync(legacyPath) || fs.existsSync(nextPath)) {
    return;
  }
  fs.mkdirSync(path.dirname(nextPath), { recursive: true });
  fs.copyFileSync(legacyPath, nextPath);
}

function DEFAULT_CONFIG_STORE_PROXY(): TopicSummaryConfigStore {
  return cloneDefaultConfigStore();
}

function DEFAULT_STATE_STORE_PROXY(): TopicSummaryStateStore {
  return cloneDefaultStateStore();
}

export function getTopicSummaryConfig(profileId?: string): TopicSummaryConfig {
  ensureTopicSummaryStorage();
  return readConfig(profileId);
}

export function setTopicSummaryConfig(input: unknown, profileId?: string): TopicSummaryConfig {
  ensureTopicSummaryStorage();
  const config = normalizeConfig(input);
  writeConfig(config, profileId);
  return config;
}

export function getTopicSummaryState(profileId?: string): TopicSummaryState {
  ensureTopicSummaryStorage();
  return readState(profileId);
}

export function clearTopicSummarySentLog(profileId?: string): TopicSummaryState {
  ensureTopicSummaryStorage();
  const next: TopicSummaryState = {
    version: 1,
    sentLog: [],
    updatedAt: new Date().toISOString()
  };
  writeState(next, profileId);
  return next;
}

export function getTopicSummarySnapshot(): TopicSummarySnapshot {
  ensureTopicSummaryStorage();
  return buildTopicSummarySnapshot();
}

export function buildTopicSummarySnapshot(): TopicSummarySnapshot {
  const configStore = readConfigStore();
  const stateStore = readStateStore();

  const profiles: TopicSummaryProfileSnapshot[] = configStore.profiles.map((profile) => {
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

export function readConfig(profileId?: string): TopicSummaryConfig {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  return profile.config;
}

export function writeConfig(config: TopicSummaryConfig, profileId?: string): void {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  profile.config = normalizeConfig(config);
  writeConfigStore(store);
}

export function readState(profileId?: string): TopicSummaryState {
  const configStore = readConfigStore();
  const profile = getProfileById(configStore, profileId);
  const stateStore = readStateStore();
  const entry = stateStore.profiles.find((item) => item.id === profile.id);
  return entry?.state ? normalizeState(entry.state) : cloneDefaultState();
}

export function writeState(state: TopicSummaryState, profileId?: string): void {
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

export function readConfigStore(): TopicSummaryConfigStore {
  const parsed = getStore<unknown>(TOPIC_SUMMARY_CONFIG_STORE);
  return normalizeConfigStoreValue(parsed);
}

export function writeConfigStore(store: TopicSummaryConfigStore): void {
  setStore(TOPIC_SUMMARY_CONFIG_STORE, normalizeConfigStoreValue(store));
}

export function readStateStore(): TopicSummaryStateStore {
  const parsed = getStore<unknown>(TOPIC_SUMMARY_STATE_STORE);
  return normalizeStateStoreValue(parsed);
}

export function writeStateStore(store: TopicSummaryStateStore): void {
  setStore(TOPIC_SUMMARY_STATE_STORE, normalizeStateStoreValue(store));
}

export function getProfileById(store: TopicSummaryConfigStore, requestedId?: string): TopicSummaryProfileConfig {
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

export function getProfileMeta(profileId?: string): TopicSummaryProfileMeta {
  const store = readConfigStore();
  const profile = getProfileById(store, profileId);
  return {
    id: profile.id,
    name: profile.name,
    config: profile.config,
    isActive: profile.id === store.activeProfileId
  };
}

export { normalizeConfigStoreValue as normalizeConfigStore, normalizeStateStoreValue as normalizeStateStore };
