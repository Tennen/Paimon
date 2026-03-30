import type {
  WritingStateSection,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicState,
  WritingTopicsPayload
} from "@/types/admin";
import { request } from "../adminApi";
import type { AdminWritingSlice } from "./slices";
import type { AdminSliceCreator } from "./types";

const DEFAULT_WRITING_TOPIC_STATE: WritingTopicState = {
  summary: "",
  outline: "",
  draft: ""
};

function normalizeWritingTopicId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeWritingTopicState(state: WritingTopicState | null | undefined): WritingTopicState {
  return {
    summary: String(state?.summary ?? "").trim(),
    outline: String(state?.outline ?? "").trim(),
    draft: String(state?.draft ?? "").trim()
  };
}

function normalizeWritingTopicMeta(input: Partial<WritingTopicMeta> | null | undefined, fallbackTopicId: string): WritingTopicMeta {
  const topicId = normalizeWritingTopicId(String(input?.topicId ?? fallbackTopicId)) || fallbackTopicId || "untitled-topic";
  const rawFileCount = Number(input?.rawFileCount);
  const rawLineCount = Number(input?.rawLineCount);
  return {
    topicId,
    title: String(input?.title ?? topicId).trim() || topicId,
    status: input?.status === "archived" ? "archived" : "active",
    rawFileCount: Number.isFinite(rawFileCount) && rawFileCount >= 0 ? Math.floor(rawFileCount) : 0,
    rawLineCount: Number.isFinite(rawLineCount) && rawLineCount >= 0 ? Math.floor(rawLineCount) : 0,
    lastSummarizedAt: String(input?.lastSummarizedAt ?? "").trim() || undefined,
    createdAt: String(input?.createdAt ?? "").trim(),
    updatedAt: String(input?.updatedAt ?? "").trim()
  };
}

function normalizeWritingTopicMetaList(input: unknown): WritingTopicMeta[] {
  const list = Array.isArray(input) ? input : [];
  const normalized: WritingTopicMeta[] = [];
  const idSet = new Set<string>();

  for (const item of list) {
    const topicId = normalizeWritingTopicId(String((item as { topicId?: unknown } | null)?.topicId ?? ""));
    if (!topicId || idSet.has(topicId)) {
      continue;
    }
    idSet.add(topicId);
    normalized.push(normalizeWritingTopicMeta(item as Partial<WritingTopicMeta>, topicId));
  }

  return normalized.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function normalizeWritingTopicDetail(detail: WritingTopicDetail | null | undefined, fallbackTopicId: string): WritingTopicDetail {
  const topicId = normalizeWritingTopicId(detail?.meta?.topicId ?? fallbackTopicId) || fallbackTopicId || "untitled-topic";
  const meta = normalizeWritingTopicMeta(detail?.meta, topicId);
  const rawFiles = Array.isArray(detail?.rawFiles)
    ? detail.rawFiles
        .map((file) => ({
          name: String(file?.name ?? "").trim(),
          lineCount: Number.isFinite(Number(file?.lineCount)) ? Math.max(0, Math.floor(Number(file?.lineCount))) : 0,
          content: String(file?.content ?? "").trim()
        }))
        .filter((file) => Boolean(file.name))
    : [];
  return {
    meta,
    state: normalizeWritingTopicState(detail?.state ?? DEFAULT_WRITING_TOPIC_STATE),
    backup: normalizeWritingTopicState(detail?.backup ?? DEFAULT_WRITING_TOPIC_STATE),
    rawFiles
  };
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export const createWritingSlice: AdminSliceCreator<AdminWritingSlice> = (set, get) => {
  const loadWritingTopicDetail = async (topicId: string, options?: { silent?: boolean }): Promise<void> => {
    const normalizedTopicId = normalizeWritingTopicId(topicId);
    if (!normalizedTopicId) {
      set({ writingTopicDetail: null });
      return;
    }

    const silent = options?.silent ?? false;
    if (!silent) {
      set({ loadingWritingDetail: true });
    }

    try {
      const payload = await request<WritingTopicDetail>(`/admin/api/writing/topics/${encodeURIComponent(normalizedTopicId)}`);
      const detail = normalizeWritingTopicDetail(payload, normalizedTopicId);
      set({
        writingTopicDetail: detail,
        writingSelectedTopicId: detail.meta.topicId,
        writingTopicTitleDraft: detail.meta.title
      });
    } finally {
      if (!silent) {
        set({ loadingWritingDetail: false });
      }
    }
  };

  return {
    writingTopics: [],
    writingSelectedTopicId: "",
    writingTopicIdDraft: "",
    writingTopicTitleDraft: "",
    writingAppendDraft: "",
    writingTopicDetail: null,
    loadingWritingTopics: false,
    loadingWritingDetail: false,
    writingActionState: null,
    writingManualSection: "summary",
    writingManualContent: "",
    setWritingTopicIdDraft: (value) => {
      set({ writingTopicIdDraft: value });
    },
    setWritingTopicTitleDraft: (value) => {
      set({ writingTopicTitleDraft: value });
    },
    setWritingAppendDraft: (value) => {
      set({ writingAppendDraft: value });
    },
    setWritingManualSection: (value) => {
      set({ writingManualSection: value });
    },
    setWritingManualContent: (value) => {
      set({ writingManualContent: value });
    },
    loadWritingTopics: async (options) => {
      set({ loadingWritingTopics: true });
      try {
        const payload = await request<WritingTopicsPayload>("/admin/api/writing/topics");
        const topics = normalizeWritingTopicMetaList(payload.topics);
        const currentSelected = get().writingSelectedTopicId;
        const preferred = normalizeWritingTopicId(options?.preferredTopicId ?? "");
        const nextSelected = topics.some((item) => item.topicId === preferred)
          ? preferred
          : topics.some((item) => item.topicId === currentSelected)
            ? currentSelected
            : (topics[0]?.topicId ?? "");

        set((state) => ({
          writingTopics: topics,
          writingSelectedTopicId: nextSelected,
          writingTopicIdDraft: !state.writingTopicIdDraft.trim() || state.writingTopicIdDraft.trim() === currentSelected
            ? nextSelected
            : state.writingTopicIdDraft
        }));

        if (nextSelected) {
          await loadWritingTopicDetail(nextSelected, { silent: true });
        } else {
          set({ writingTopicDetail: null });
        }
      } finally {
        set({ loadingWritingTopics: false });
      }
    },
    handleWritingTopicSelect: (topicId) => {
      const normalizedTopicId = normalizeWritingTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }

      const target = get().writingTopics.find((item) => item.topicId === normalizedTopicId);
      set({
        writingSelectedTopicId: normalizedTopicId,
        writingTopicIdDraft: normalizedTopicId,
        writingTopicTitleDraft: target ? target.title : get().writingTopicTitleDraft,
        writingManualContent: ""
      });
      void loadWritingTopicDetail(normalizedTopicId);
    },
    handleAppendWritingTopic: async () => {
      const topicId = normalizeWritingTopicId(get().writingTopicIdDraft);
      if (!topicId) {
        get().setNotice({ type: "error", title: "请先输入合法 topicId" });
        return;
      }

      const content = get().writingAppendDraft.trim();
      if (!content) {
        get().setNotice({ type: "error", title: "append content 不能为空" });
        return;
      }

      const title = get().writingTopicTitleDraft.trim();
      set({ writingActionState: "append" });
      try {
        const payload = await request<{ ok: boolean; result?: { topicId?: string } }>(
          `/admin/api/writing/topics/${encodeURIComponent(topicId)}/append`,
          {
            method: "POST",
            body: JSON.stringify({
              content,
              ...(title ? { title } : {})
            })
          }
        );
        const nextTopicId = normalizeWritingTopicId(payload.result?.topicId ?? topicId) || topicId;
        set({
          writingAppendDraft: "",
          writingSelectedTopicId: nextTopicId,
          writingTopicIdDraft: nextTopicId
        });
        await get().loadWritingTopics({ preferredTopicId: nextTopicId });
        get().setNotice({ type: "success", title: `已追加内容到 topic: ${nextTopicId}` });
      } catch (error) {
        get().setNotice({ type: "error", title: "追加 writing 内容失败", text: toErrorText(error) });
      } finally {
        set({ writingActionState: null });
      }
    },
    handleSummarizeWritingTopic: async () => {
      const topicId = normalizeWritingTopicId(get().writingSelectedTopicId || get().writingTopicIdDraft);
      if (!topicId) {
        get().setNotice({ type: "error", title: "请先选择或输入 topicId" });
        return;
      }

      set({ writingActionState: "summarize" });
      try {
        await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/summarize`, {
          method: "POST",
          body: "{}"
        });
        await get().loadWritingTopics({ preferredTopicId: topicId });
        get().setNotice({ type: "success", title: `topic ${topicId} summarize 完成` });
      } catch (error) {
        get().setNotice({ type: "error", title: "执行 writing summarize 失败", text: toErrorText(error) });
      } finally {
        set({ writingActionState: null });
      }
    },
    handleRestoreWritingTopic: async () => {
      const topicId = normalizeWritingTopicId(get().writingSelectedTopicId || get().writingTopicIdDraft);
      if (!topicId) {
        get().setNotice({ type: "error", title: "请先选择或输入 topicId" });
        return;
      }

      set({ writingActionState: "restore" });
      try {
        await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/restore`, {
          method: "POST",
          body: "{}"
        });
        await get().loadWritingTopics({ preferredTopicId: topicId });
        get().setNotice({ type: "success", title: `topic ${topicId} 已恢复上一版` });
      } catch (error) {
        get().setNotice({ type: "error", title: "执行 writing restore 失败", text: toErrorText(error) });
      } finally {
        set({ writingActionState: null });
      }
    },
    handleSetWritingTopicState: async () => {
      const topicId = normalizeWritingTopicId(get().writingSelectedTopicId || get().writingTopicIdDraft);
      if (!topicId) {
        get().setNotice({ type: "error", title: "请先选择或输入 topicId" });
        return;
      }

      const content = get().writingManualContent.trim();
      if (!content) {
        get().setNotice({ type: "error", title: "手动 state 内容不能为空" });
        return;
      }

      set({ writingActionState: "set" });
      try {
        await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/state`, {
          method: "POST",
          body: JSON.stringify({
            section: get().writingManualSection,
            content
          })
        });
        await get().loadWritingTopics({ preferredTopicId: topicId });
        get().setNotice({ type: "success", title: `topic ${topicId} 的 ${get().writingManualSection} 已更新` });
      } catch (error) {
        get().setNotice({ type: "error", title: "手动更新 writing state 失败", text: toErrorText(error) });
      } finally {
        set({ writingActionState: null });
      }
    }
  };
};
