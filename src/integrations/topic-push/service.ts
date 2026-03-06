import { buildHelpText, formatConfig, formatDigest, formatSources, formatState } from "./formatters";
import {
  formatProfiles,
  formatSingleProfile,
  formatSingleSource,
  handleAddProfile,
  handleAddSource,
  handleClearSentLog,
  handleDeleteProfile,
  handleDeleteSource,
  handleToggleSource,
  handleUpdateProfile,
  handleUpdateSource,
  handleUseProfile
} from "./mutations";
import { resolveRunTargetLanguage } from "./planning";
import { mergeSentLog, runDigest } from "./runtime";
import {
  clearTopicPushSentLog as clearTopicPushSentLogStore,
  ensureTopicPushStorage,
  getProfileMeta,
  getTopicPushConfig,
  getTopicPushSnapshot,
  getTopicPushState,
  readConfig,
  readState,
  setTopicPushConfig,
  writeState
} from "./storage";
import { parseCommand } from "./commands";
import type {
  TopicPushExecuteOptions,
  TopicPushProfileCreateInput,
  TopicPushProfileUpdateInput,
  TopicPushSnapshot
} from "./types";

export const directCommands = ["/topic"];

export type {
  TopicPushCategory,
  TopicKey,
  TopicPushSource,
  TopicPushFilters,
  TopicPushDailyQuota,
  TopicPushSummaryEngine,
  TopicPushDigestLanguage,
  TopicPushConfig,
  TopicPushSentLogItem,
  TopicPushState,
  TopicPushProfileSnapshot,
  TopicPushSnapshot,
  TopicPushProfileCreateInput,
  TopicPushProfileUpdateInput,
  TopicPushExecuteOptions
} from "./types";

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
      case "sources_list": {
        const profile = getProfileMeta(command.profileId);
        return { text: formatSources(readConfig(command.profileId).sources, profile) };
      }
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
      case "config_show": {
        const profile = getProfileMeta(command.profileId);
        return { text: formatConfig(readConfig(command.profileId), profile) };
      }
      case "state_show": {
        const profile = getProfileMeta(command.profileId);
        return { text: formatState(readState(command.profileId), profile) };
      }
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
export {
  clearTopicPushSentLogStore as clearTopicPushSentLog,
  getTopicPushConfig,
  getTopicPushSnapshot,
  getTopicPushState,
  setTopicPushConfig
};

export function addTopicPushProfile(input: TopicPushProfileCreateInput): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleAddProfile(input);
  return getTopicPushSnapshot();
}

export function updateTopicPushProfile(id: string, patch: TopicPushProfileUpdateInput): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleUpdateProfile(id, patch);
  return getTopicPushSnapshot();
}

export function useTopicPushProfile(id: string): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleUseProfile(id);
  return getTopicPushSnapshot();
}

export function deleteTopicPushProfile(id: string): TopicPushSnapshot {
  ensureTopicPushStorage();
  handleDeleteProfile(id);
  return getTopicPushSnapshot();
}
