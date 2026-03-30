import { DEFAULT_TOPIC_SUMMARY_CONFIG, DEFAULT_TOPIC_SUMMARY_STATE } from "@/types/admin";
import type {
  TopicSummaryConfig,
  TopicSummaryDigestLanguage,
  TopicSummaryEngine,
  TopicSummaryProfile,
  TopicSummaryProfilesPayload,
  TopicSummarySource
} from "@/types/admin";
import { request } from "../adminApi";
import {
  buildNextTopicSourceId,
  normalizeTopicProfileId,
  normalizeTopicSummaryConfig,
  normalizeTopicSummaryDefaultLanguage,
  normalizeTopicSummaryProfilesPayload,
  normalizeTopicSummarySource,
  normalizeTopicSummaryState,
  resolveTopicSummaryProviderId
} from "../topicAdminUtils";
import type { AdminTopicSlice, TopicSummaryLoadOptions } from "./slices";
import type { AdminSliceCreator } from "./types";

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function resolveSelectedProfile(
  profiles: TopicSummaryProfile[],
  activeProfileId: string,
  preferredProfileId: string
): TopicSummaryProfile | null {
  if (preferredProfileId) {
    const preferred = profiles.find((item) => item.id === preferredProfileId);
    if (preferred) {
      return preferred;
    }
  }
  const active = profiles.find((item) => item.id === activeProfileId);
  if (active) {
    return active;
  }
  return profiles[0] ?? null;
}

export const createTopicSlice: AdminSliceCreator<AdminTopicSlice> = (set, get) => {
  const applyTopicSummaryPayload = (
    payload: TopicSummaryProfilesPayload | { activeProfileId: string; profiles: TopicSummaryProfile[] },
    options?: TopicSummaryLoadOptions
  ): void => {
    const normalizedProfilesPayload = normalizeTopicSummaryProfilesPayload(payload as TopicSummaryProfilesPayload);
    const nextActiveProfileId = normalizedProfilesPayload.activeProfileId;
    const preferredProfileId = normalizeTopicProfileId(
      options?.preferredProfileId ?? get().topicSummarySelectedProfileId ?? nextActiveProfileId
    );
    const nextSelectedProfile = resolveSelectedProfile(
      normalizedProfilesPayload.profiles,
      nextActiveProfileId,
      preferredProfileId
    );
    const nextConfigRaw = normalizeTopicSummaryConfig(nextSelectedProfile?.config ?? DEFAULT_TOPIC_SUMMARY_CONFIG);

    set({
      topicSummaryProfiles: normalizedProfilesPayload.profiles,
      topicSummaryActiveProfileId: nextActiveProfileId,
      topicSummarySelectedProfileId: nextSelectedProfile?.id ?? nextActiveProfileId,
      topicSummaryConfig: {
        ...nextConfigRaw,
        summaryEngine: resolveTopicSummaryProviderId(nextConfigRaw.summaryEngine, get().llmProviderStore)
      },
      topicSummaryState: normalizeTopicSummaryState(nextSelectedProfile?.state ?? DEFAULT_TOPIC_SUMMARY_STATE)
    });
  };

  return {
    topicSummaryProfiles: [],
    topicSummaryActiveProfileId: "",
    topicSummarySelectedProfileId: "",
    topicSummaryConfig: DEFAULT_TOPIC_SUMMARY_CONFIG,
    topicSummaryState: DEFAULT_TOPIC_SUMMARY_STATE,
    savingTopicSummaryProfileAction: false,
    savingTopicSummaryConfig: false,
    clearingTopicSummaryState: false,
    syncTopicSummaryProviderBinding: () => {
      set((state) => {
        const nextSummaryEngine = resolveTopicSummaryProviderId(state.topicSummaryConfig.summaryEngine, state.llmProviderStore);
        if (nextSummaryEngine === state.topicSummaryConfig.summaryEngine) {
          return state;
        }
        return {
          topicSummaryConfig: {
            ...state.topicSummaryConfig,
            summaryEngine: nextSummaryEngine
          }
        };
      });
    },
    loadTopicSummaryConfig: async (options) => {
      const payload = await request<TopicSummaryProfilesPayload>("/admin/api/topic-summary/config");
      applyTopicSummaryPayload(payload, options);
    },
    handleTopicProfileSelect: (profileId) => {
      const normalizedProfileId = normalizeTopicProfileId(profileId);
      const selectedProfile = get().topicSummaryProfiles.find((item) => item.id === normalizedProfileId);
      if (!selectedProfile) {
        return;
      }
      const nextConfig = normalizeTopicSummaryConfig(selectedProfile.config);
      set({
        topicSummarySelectedProfileId: selectedProfile.id,
        topicSummaryConfig: {
          ...nextConfig,
          summaryEngine: resolveTopicSummaryProviderId(nextConfig.summaryEngine, get().llmProviderStore)
        },
        topicSummaryState: normalizeTopicSummaryState(selectedProfile.state)
      });
    },
    handleAddTopicProfile: async () => {
      const name = window.prompt("输入新的 Topic Summary profile 名称");
      if (!name) {
        return;
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        get().setNotice({ type: "error", title: "profile 名称不能为空" });
        return;
      }

      set({ savingTopicSummaryProfileAction: true });
      try {
        const payload = await request<{
          ok: boolean;
          snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
        }>("/admin/api/topic-summary/profiles", {
          method: "POST",
          body: JSON.stringify({
            id: normalizeTopicProfileId(trimmedName) || undefined,
            name: trimmedName,
            cloneFrom: get().topicSummarySelectedProfileId || get().topicSummaryActiveProfileId || undefined
          })
        });
        applyTopicSummaryPayload(payload.snapshot, {
          preferredProfileId: normalizeTopicProfileId(trimmedName)
        });
        get().setNotice({ type: "success", title: `已新增 Topic Summary profile: ${trimmedName}` });
      } catch (error) {
        get().setNotice({ type: "error", title: "新增 Topic Summary profile 失败", text: toErrorText(error) });
      } finally {
        set({ savingTopicSummaryProfileAction: false });
      }
    },
    handleRenameTopicProfile: async () => {
      const selectedProfile = get().topicSummaryProfiles.find((item) => item.id === get().topicSummarySelectedProfileId);
      if (!selectedProfile) {
        get().setNotice({ type: "error", title: "请先选择 profile" });
        return;
      }

      const name = window.prompt("输入新的 Topic Summary profile 名称", selectedProfile.name);
      if (!name) {
        return;
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        get().setNotice({ type: "error", title: "profile 名称不能为空" });
        return;
      }

      set({ savingTopicSummaryProfileAction: true });
      try {
        const payload = await request<{
          ok: boolean;
          snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
        }>(`/admin/api/topic-summary/profiles/${encodeURIComponent(selectedProfile.id)}`, {
          method: "PUT",
          body: JSON.stringify({ name: trimmedName })
        });
        applyTopicSummaryPayload(payload.snapshot, {
          preferredProfileId: selectedProfile.id
        });
        get().setNotice({ type: "success", title: `profile 已重命名为 ${trimmedName}` });
      } catch (error) {
        get().setNotice({ type: "error", title: "重命名 Topic Summary profile 失败", text: toErrorText(error) });
      } finally {
        set({ savingTopicSummaryProfileAction: false });
      }
    },
    handleUseTopicProfile: async () => {
      const selectedProfile = get().topicSummaryProfiles.find((item) => item.id === get().topicSummarySelectedProfileId);
      if (!selectedProfile) {
        get().setNotice({ type: "error", title: "请先选择 profile" });
        return;
      }

      set({ savingTopicSummaryProfileAction: true });
      try {
        const payload = await request<{
          ok: boolean;
          snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
        }>(`/admin/api/topic-summary/profiles/${encodeURIComponent(selectedProfile.id)}/use`, {
          method: "POST",
          body: "{}"
        });
        applyTopicSummaryPayload(payload.snapshot, {
          preferredProfileId: selectedProfile.id
        });
        get().setNotice({ type: "success", title: `已切换 active profile: ${selectedProfile.name}` });
      } catch (error) {
        get().setNotice({ type: "error", title: "切换 Topic Summary profile 失败", text: toErrorText(error) });
      } finally {
        set({ savingTopicSummaryProfileAction: false });
      }
    },
    handleDeleteTopicProfile: async () => {
      const selectedProfile = get().topicSummaryProfiles.find((item) => item.id === get().topicSummarySelectedProfileId);
      if (!selectedProfile) {
        get().setNotice({ type: "error", title: "请先选择 profile" });
        return;
      }

      const confirmed = window.confirm(`确认删除 Topic Summary profile "${selectedProfile.name}" 吗？`);
      if (!confirmed) {
        return;
      }

      set({ savingTopicSummaryProfileAction: true });
      try {
        const payload = await request<{
          ok: boolean;
          snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
        }>(`/admin/api/topic-summary/profiles/${encodeURIComponent(selectedProfile.id)}`, {
          method: "DELETE",
          body: "{}"
        });
        applyTopicSummaryPayload(payload.snapshot);
        get().setNotice({ type: "success", title: `已删除 Topic Summary profile: ${selectedProfile.name}` });
      } catch (error) {
        get().setNotice({ type: "error", title: "删除 Topic Summary profile 失败", text: toErrorText(error) });
      } finally {
        set({ savingTopicSummaryProfileAction: false });
      }
    },
    handleTopicSummaryEngineChange: (value: TopicSummaryEngine) => {
      set((state) => ({
        topicSummaryConfig: {
          ...state.topicSummaryConfig,
          summaryEngine: resolveTopicSummaryProviderId(value, state.llmProviderStore)
        }
      }));
    },
    handleTopicDefaultLanguageChange: (value: TopicSummaryDigestLanguage) => {
      set((state) => ({
        topicSummaryConfig: {
          ...state.topicSummaryConfig,
          defaultLanguage: normalizeTopicSummaryDefaultLanguage(value)
        }
      }));
    },
    handleTopicSourceChange: (index, patch) => {
      set((state) => ({
        topicSummaryConfig: {
          ...state.topicSummaryConfig,
          sources: state.topicSummaryConfig.sources.map((source, sourceIndex) => {
            if (sourceIndex !== index) {
              return source;
            }
            return normalizeTopicSummarySource(
              {
                ...source,
                ...patch
              },
              index
            );
          })
        }
      }));
    },
    handleAddTopicSource: () => {
      set((state) => ({
        topicSummaryConfig: {
          ...state.topicSummaryConfig,
          sources: state.topicSummaryConfig.sources.concat({
            id: buildNextTopicSourceId("source", state.topicSummaryConfig.sources.map((item) => item.id)),
            name: "",
            category: "engineering",
            feedUrl: "",
            weight: 1,
            enabled: true
          })
        }
      }));
    },
    handleRemoveTopicSource: (index) => {
      set((state) => ({
        topicSummaryConfig: {
          ...state.topicSummaryConfig,
          sources: state.topicSummaryConfig.sources.filter((_, sourceIndex) => sourceIndex !== index)
        }
      }));
    },
    handleSaveTopicSummaryConfig: async () => {
      const profileId = get().topicSummarySelectedProfileId || get().topicSummaryActiveProfileId;
      if (!profileId) {
        get().setNotice({ type: "error", title: "缺少可保存的 Topic Summary profile" });
        return;
      }

      const normalizedConfig = normalizeTopicSummaryConfig({
        ...get().topicSummaryConfig,
        summaryEngine: resolveTopicSummaryProviderId(get().topicSummaryConfig.summaryEngine, get().llmProviderStore)
      });

      set({ savingTopicSummaryConfig: true });
      try {
        const payload = await request<{
          ok: boolean;
          profileId: string;
          config: TopicSummaryConfig;
          snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
        }>("/admin/api/topic-summary/config", {
          method: "PUT",
          body: JSON.stringify({
            profileId,
            config: normalizedConfig
          })
        });
        applyTopicSummaryPayload(payload.snapshot, {
          preferredProfileId: profileId
        });
        get().setNotice({ type: "success", title: `Topic Summary 配置已保存到 ${profileId}` });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存 Topic Summary 配置失败", text: toErrorText(error) });
      } finally {
        set({ savingTopicSummaryConfig: false });
      }
    },
    handleClearTopicSummaryState: async () => {
      const profileId = get().topicSummarySelectedProfileId || get().topicSummaryActiveProfileId;
      if (!profileId) {
        get().setNotice({ type: "error", title: "缺少可清理的 Topic Summary profile" });
        return;
      }

      set({ clearingTopicSummaryState: true });
      try {
        const payload = await request<{
          ok: boolean;
          profileId: string;
          snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
        }>("/admin/api/topic-summary/state/clear", {
          method: "POST",
          body: JSON.stringify({ profileId })
        });
        applyTopicSummaryPayload(payload.snapshot, {
          preferredProfileId: profileId
        });
        get().setNotice({ type: "success", title: `已清空 ${profileId} 的 sent log` });
      } catch (error) {
        get().setNotice({ type: "error", title: "清空 Topic Summary sent log 失败", text: toErrorText(error) });
      } finally {
        set({ clearingTopicSummaryState: false });
      }
    }
  };
};
