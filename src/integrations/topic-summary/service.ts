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
  clearTopicSummarySentLog as clearTopicSummarySentLogStore,
  ensureTopicSummaryStorage,
  getProfileMeta,
  getTopicSummaryConfig,
  getTopicSummarySnapshot,
  getTopicSummaryState,
  readConfig,
  readState,
  setTopicSummaryConfig,
  writeState
} from "./storage";
import { parseCommand } from "./commands";
import type {
  TopicSummaryExecuteOptions,
  TopicSummaryProfileCreateInput,
  TopicSummaryProfileUpdateInput,
  TopicSummarySnapshot
} from "./types";

export const directCommands = ["/topic"];

export type {
  TopicSummaryCategory,
  TopicKey,
  TopicSummarySource,
  TopicSummaryFilters,
  TopicSummaryDailyQuota,
  TopicSummaryEngine,
  TopicSummaryDigestLanguage,
  TopicSummaryConfig,
  TopicSummarySentLogItem,
  TopicSummaryState,
  TopicSummaryProfileSnapshot,
  TopicSummarySnapshot,
  TopicSummaryProfileCreateInput,
  TopicSummaryProfileUpdateInput,
  TopicSummaryExecuteOptions
} from "./types";

export async function execute(
  input: string,
  options?: TopicSummaryExecuteOptions
): Promise<{ text: string; result?: unknown }> {
  try {
    ensureTopicSummaryStorage();
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
      text: `Topic Summary 执行失败: ${(error as Error).message ?? "unknown error"}`
    };
  }
}
export {
  clearTopicSummarySentLogStore as clearTopicSummarySentLog,
  getTopicSummaryConfig,
  getTopicSummarySnapshot,
  getTopicSummaryState,
  setTopicSummaryConfig
};

export function addTopicSummaryProfile(input: TopicSummaryProfileCreateInput): TopicSummarySnapshot {
  ensureTopicSummaryStorage();
  handleAddProfile(input);
  return getTopicSummarySnapshot();
}

export function updateTopicSummaryProfile(id: string, patch: TopicSummaryProfileUpdateInput): TopicSummarySnapshot {
  ensureTopicSummaryStorage();
  handleUpdateProfile(id, patch);
  return getTopicSummarySnapshot();
}

export function useTopicSummaryProfile(id: string): TopicSummarySnapshot {
  ensureTopicSummaryStorage();
  handleUseProfile(id);
  return getTopicSummarySnapshot();
}

export function deleteTopicSummaryProfile(id: string): TopicSummarySnapshot {
  ensureTopicSummaryStorage();
  handleDeleteProfile(id);
  return getTopicSummarySnapshot();
}
