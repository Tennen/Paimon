import { useState } from "react";
import type {
  LLMProviderStore,
  Notice,
  TopicSummaryConfig,
  TopicSummaryDigestLanguage,
  TopicSummaryEngine,
  TopicSummaryProfile,
  TopicSummaryProfilesPayload,
  TopicSummarySource,
  TopicSummaryState
} from "@/types/admin";
import { DEFAULT_TOPIC_SUMMARY_CONFIG, DEFAULT_TOPIC_SUMMARY_STATE } from "@/types/admin";
import { request } from "./adminApi";
import {
  buildNextTopicSourceId,
  normalizeTopicProfileId,
  normalizeTopicSummaryConfig,
  normalizeTopicSummaryDefaultLanguage,
  normalizeTopicSummaryProfilesPayload,
  normalizeTopicSummarySource,
  normalizeTopicSummaryState,
  resolveTopicSummaryProviderId
} from "./topicAdminUtils";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type UseTopicAdminStateArgs = {
  llmProviderStore: LLMProviderStore | null;
  setNotice: NoticeSetter;
};

type LoadTopicSummaryConfigOptions = {
  llmProviderStore?: LLMProviderStore | null;
  preferredProfileId?: string;
};

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

export function useTopicAdminState(args: UseTopicAdminStateArgs) {
  const [topicSummaryProfiles, setTopicSummaryProfiles] = useState<TopicSummaryProfile[]>([]);
  const [topicSummaryActiveProfileId, setTopicSummaryActiveProfileId] = useState("");
  const [topicSummarySelectedProfileId, setTopicSummarySelectedProfileId] = useState("");
  const [topicSummaryConfig, setTopicSummaryConfig] = useState<TopicSummaryConfig>(DEFAULT_TOPIC_SUMMARY_CONFIG);
  const [topicSummaryState, setTopicSummaryState] = useState<TopicSummaryState>(DEFAULT_TOPIC_SUMMARY_STATE);
  const [savingTopicSummaryProfileAction, setSavingTopicSummaryProfileAction] = useState(false);
  const [savingTopicSummaryConfig, setSavingTopicSummaryConfig] = useState(false);
  const [clearingTopicSummaryState, setClearingTopicSummaryState] = useState(false);

  function applyTopicSummaryPayload(
    payload: TopicSummaryProfilesPayload | { activeProfileId: string; profiles: TopicSummaryProfile[] },
    options?: LoadTopicSummaryConfigOptions
  ): void {
    const normalizedProfilesPayload = normalizeTopicSummaryProfilesPayload(payload as TopicSummaryProfilesPayload);
    const nextActiveProfileId = normalizedProfilesPayload.activeProfileId;
    const preferredProfileId = normalizeTopicProfileId(
      options?.preferredProfileId ?? topicSummarySelectedProfileId ?? nextActiveProfileId
    );
    const nextSelectedProfile = resolveSelectedProfile(
      normalizedProfilesPayload.profiles,
      nextActiveProfileId,
      preferredProfileId
    );
    const llmProviderStore = options?.llmProviderStore ?? args.llmProviderStore;
    const nextConfig = normalizeTopicSummaryConfig(nextSelectedProfile?.config ?? DEFAULT_TOPIC_SUMMARY_CONFIG);

    setTopicSummaryProfiles(normalizedProfilesPayload.profiles);
    setTopicSummaryActiveProfileId(nextActiveProfileId);
    setTopicSummarySelectedProfileId(nextSelectedProfile?.id ?? nextActiveProfileId);
    setTopicSummaryConfig({
      ...nextConfig,
      summaryEngine: resolveTopicSummaryProviderId(nextConfig.summaryEngine, llmProviderStore)
    });
    setTopicSummaryState(normalizeTopicSummaryState(nextSelectedProfile?.state ?? DEFAULT_TOPIC_SUMMARY_STATE));
  }

  async function loadTopicSummaryConfig(options?: LoadTopicSummaryConfigOptions): Promise<void> {
    const payload = await request<TopicSummaryProfilesPayload>("/admin/api/topic-summary/config");
    applyTopicSummaryPayload(payload, options);
  }

  function handleTopicProfileSelect(profileId: string): void {
    const normalizedProfileId = normalizeTopicProfileId(profileId);
    const selectedProfile = topicSummaryProfiles.find((item) => item.id === normalizedProfileId);
    if (!selectedProfile) {
      return;
    }
    const nextConfig = normalizeTopicSummaryConfig(selectedProfile.config);
    setTopicSummarySelectedProfileId(selectedProfile.id);
    setTopicSummaryConfig({
      ...nextConfig,
      summaryEngine: resolveTopicSummaryProviderId(nextConfig.summaryEngine, args.llmProviderStore)
    });
    setTopicSummaryState(normalizeTopicSummaryState(selectedProfile.state));
  }

  async function handleAddTopicProfile(): Promise<void> {
    const name = window.prompt("输入新的 Topic Summary profile 名称");
    if (!name) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      args.setNotice({ type: "error", title: "profile 名称不能为空" });
      return;
    }

    setSavingTopicSummaryProfileAction(true);
    try {
      const payload = await request<{
        ok: boolean;
        snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
      }>("/admin/api/topic-summary/profiles", {
        method: "POST",
        body: JSON.stringify({
          id: normalizeTopicProfileId(trimmedName) || undefined,
          name: trimmedName,
          cloneFrom: topicSummarySelectedProfileId || topicSummaryActiveProfileId || undefined
        })
      });
      applyTopicSummaryPayload(payload.snapshot, {
        preferredProfileId: normalizeTopicProfileId(trimmedName)
      });
      args.setNotice({ type: "success", title: `已新增 Topic Summary profile: ${trimmedName}` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "新增 Topic Summary profile 失败", text });
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  async function handleRenameTopicProfile(): Promise<void> {
    const selectedProfile = topicSummaryProfiles.find((item) => item.id === topicSummarySelectedProfileId);
    if (!selectedProfile) {
      args.setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const name = window.prompt("输入新的 Topic Summary profile 名称", selectedProfile.name);
    if (!name) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      args.setNotice({ type: "error", title: "profile 名称不能为空" });
      return;
    }

    setSavingTopicSummaryProfileAction(true);
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
      args.setNotice({ type: "success", title: `profile 已重命名为 ${trimmedName}` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "重命名 Topic Summary profile 失败", text });
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  async function handleUseTopicProfile(): Promise<void> {
    const selectedProfile = topicSummaryProfiles.find((item) => item.id === topicSummarySelectedProfileId);
    if (!selectedProfile) {
      args.setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    setSavingTopicSummaryProfileAction(true);
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
      args.setNotice({ type: "success", title: `已切换 active profile: ${selectedProfile.name}` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "切换 Topic Summary profile 失败", text });
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  async function handleDeleteTopicProfile(): Promise<void> {
    const selectedProfile = topicSummaryProfiles.find((item) => item.id === topicSummarySelectedProfileId);
    if (!selectedProfile) {
      args.setNotice({ type: "error", title: "请先选择 profile" });
      return;
    }

    const confirmed = window.confirm(`确认删除 Topic Summary profile "${selectedProfile.name}" 吗？`);
    if (!confirmed) {
      return;
    }

    setSavingTopicSummaryProfileAction(true);
    try {
      const payload = await request<{
        ok: boolean;
        snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
      }>(`/admin/api/topic-summary/profiles/${encodeURIComponent(selectedProfile.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      applyTopicSummaryPayload(payload.snapshot);
      args.setNotice({ type: "success", title: `已删除 Topic Summary profile: ${selectedProfile.name}` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "删除 Topic Summary profile 失败", text });
    } finally {
      setSavingTopicSummaryProfileAction(false);
    }
  }

  function handleTopicSummaryEngineChange(value: TopicSummaryEngine): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      summaryEngine: resolveTopicSummaryProviderId(value, args.llmProviderStore)
    }));
  }

  function handleTopicDefaultLanguageChange(value: TopicSummaryDigestLanguage): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      defaultLanguage: normalizeTopicSummaryDefaultLanguage(value)
    }));
  }

  function handleTopicSourceChange(index: number, patch: Partial<TopicSummarySource>): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      sources: prev.sources.map((source, sourceIndex) => {
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
    }));
  }

  function handleAddTopicSource(): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      sources: prev.sources.concat({
        id: buildNextTopicSourceId("source", prev.sources.map((item) => item.id)),
        name: "",
        category: "engineering",
        feedUrl: "",
        weight: 1,
        enabled: true
      })
    }));
  }

  function handleRemoveTopicSource(index: number): void {
    setTopicSummaryConfig((prev) => ({
      ...prev,
      sources: prev.sources.filter((_, sourceIndex) => sourceIndex !== index)
    }));
  }

  async function handleSaveTopicSummaryConfig(): Promise<void> {
    const profileId = topicSummarySelectedProfileId || topicSummaryActiveProfileId;
    if (!profileId) {
      args.setNotice({ type: "error", title: "缺少可保存的 Topic Summary profile" });
      return;
    }

    const normalizedConfig = normalizeTopicSummaryConfig({
      ...topicSummaryConfig,
      summaryEngine: resolveTopicSummaryProviderId(topicSummaryConfig.summaryEngine, args.llmProviderStore)
    });

    setSavingTopicSummaryConfig(true);
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
      args.setNotice({ type: "success", title: `Topic Summary 配置已保存到 ${profileId}` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "保存 Topic Summary 配置失败", text });
    } finally {
      setSavingTopicSummaryConfig(false);
    }
  }

  async function handleClearTopicSummaryState(): Promise<void> {
    const profileId = topicSummarySelectedProfileId || topicSummaryActiveProfileId;
    if (!profileId) {
      args.setNotice({ type: "error", title: "缺少可清理的 Topic Summary profile" });
      return;
    }

    setClearingTopicSummaryState(true);
    try {
      const payload = await request<{
        ok: boolean;
        profileId: string;
        state: TopicSummaryState;
        snapshot: { activeProfileId: string; profiles: TopicSummaryProfile[] };
      }>("/admin/api/topic-summary/state/clear", {
        method: "POST",
        body: JSON.stringify({ profileId })
      });
      applyTopicSummaryPayload(payload.snapshot, {
        preferredProfileId: profileId
      });
      args.setNotice({ type: "success", title: `已清空 ${profileId} 的 sent log` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "清空 Topic Summary sent log 失败", text });
    } finally {
      setClearingTopicSummaryState(false);
    }
  }

  return {
    topicSummaryProfiles,
    topicSummaryActiveProfileId,
    topicSummarySelectedProfileId,
    topicSummaryConfig,
    topicSummaryState,
    savingTopicSummaryProfileAction,
    savingTopicSummaryConfig,
    clearingTopicSummaryState,
    loadTopicSummaryConfig,
    handleTopicProfileSelect,
    handleAddTopicProfile,
    handleRenameTopicProfile,
    handleUseTopicProfile,
    handleDeleteTopicProfile,
    handleTopicSummaryEngineChange,
    handleTopicDefaultLanguageChange,
    handleTopicSourceChange,
    handleAddTopicSource,
    handleRemoveTopicSource,
    handleSaveTopicSummaryConfig,
    handleClearTopicSummaryState
  };
}
