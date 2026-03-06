import { cloneDefaultConfig, cloneDefaultState } from "./defaults";
import { clampWeight, normalizeFeedUrl, normalizeProfileId, normalizeText } from "./shared";
import {
  getProfileMeta,
  normalizeConfig,
  normalizeSource,
  readConfig,
  readConfigStore,
  readState,
  readStateStore,
  writeConfig,
  writeConfigStore,
  writeState,
  writeStateStore
} from "./storage";
import { TopicPushCategory, TopicPushSource } from "./types";

export function handleAddSource(payload: {
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

export function handleUpdateSource(
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

export function handleDeleteSource(id: string, profileId?: string): string {
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

export function handleToggleSource(id: string, enabled: boolean, profileId?: string): string {
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

export function formatSingleSource(id: string, profileId?: string): string {
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

export function handleClearSentLog(profileId?: string): string {
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

export function handleAddProfile(payload: { id?: string; name: string; cloneFrom?: string }): string {
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

export function handleUpdateProfile(id: string, patch: { name?: string }): string {
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

export function handleUseProfile(id: string): string {
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

export function handleDeleteProfile(id: string): string {
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

export function formatProfiles(): string {
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

export function formatSingleProfile(id: string): string {
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
