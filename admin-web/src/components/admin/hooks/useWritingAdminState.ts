import { useState } from "react";
import type {
  Notice,
  WritingStateSection,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicState,
  WritingTopicsPayload
} from "@/types/admin";
import { request } from "./adminApi";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type UseWritingAdminStateArgs = {
  setNotice: NoticeSetter;
};

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

export function useWritingAdminState(args: UseWritingAdminStateArgs) {
  const [writingTopics, setWritingTopics] = useState<WritingTopicMeta[]>([]);
  const [writingSelectedTopicId, setWritingSelectedTopicId] = useState("");
  const [writingTopicIdDraft, setWritingTopicIdDraft] = useState("");
  const [writingTopicTitleDraft, setWritingTopicTitleDraft] = useState("");
  const [writingAppendDraft, setWritingAppendDraft] = useState("");
  const [writingTopicDetail, setWritingTopicDetail] = useState<WritingTopicDetail | null>(null);
  const [loadingWritingTopics, setLoadingWritingTopics] = useState(false);
  const [loadingWritingDetail, setLoadingWritingDetail] = useState(false);
  const [writingActionState, setWritingActionState] = useState<"append" | "summarize" | "restore" | "set" | null>(null);
  const [writingManualSection, setWritingManualSection] = useState<WritingStateSection>("summary");
  const [writingManualContent, setWritingManualContent] = useState("");

  async function loadWritingTopicDetail(topicId: string, options?: { silent?: boolean }): Promise<void> {
    const normalizedTopicId = normalizeWritingTopicId(topicId);
    if (!normalizedTopicId) {
      setWritingTopicDetail(null);
      return;
    }

    const silent = options?.silent ?? false;
    if (!silent) {
      setLoadingWritingDetail(true);
    }

    try {
      const payload = await request<WritingTopicDetail>(`/admin/api/writing/topics/${encodeURIComponent(normalizedTopicId)}`);
      const detail = normalizeWritingTopicDetail(payload, normalizedTopicId);
      setWritingTopicDetail(detail);
      setWritingSelectedTopicId(detail.meta.topicId);
      setWritingTopicTitleDraft(detail.meta.title);
    } finally {
      if (!silent) {
        setLoadingWritingDetail(false);
      }
    }
  }

  async function loadWritingTopics(options?: { preferredTopicId?: string }): Promise<void> {
    setLoadingWritingTopics(true);
    try {
      const payload = await request<WritingTopicsPayload>("/admin/api/writing/topics");
      const topics = normalizeWritingTopicMetaList(payload.topics);
      setWritingTopics(topics);

      const currentSelected = writingSelectedTopicId;
      const preferred = normalizeWritingTopicId(options?.preferredTopicId ?? "");
      const nextSelected = topics.some((item) => item.topicId === preferred)
        ? preferred
        : topics.some((item) => item.topicId === currentSelected)
          ? currentSelected
          : (topics[0]?.topicId ?? "");

      setWritingSelectedTopicId(nextSelected);
      if (!writingTopicIdDraft.trim() || writingTopicIdDraft.trim() === currentSelected) {
        setWritingTopicIdDraft(nextSelected);
      }

      if (nextSelected) {
        await loadWritingTopicDetail(nextSelected, { silent: true });
      } else {
        setWritingTopicDetail(null);
      }
    } finally {
      setLoadingWritingTopics(false);
    }
  }

  function handleWritingTopicSelect(topicId: string): void {
    const normalizedTopicId = normalizeWritingTopicId(topicId);
    if (!normalizedTopicId) {
      return;
    }

    setWritingSelectedTopicId(normalizedTopicId);
    setWritingTopicIdDraft(normalizedTopicId);
    const target = writingTopics.find((item) => item.topicId === normalizedTopicId);
    if (target) {
      setWritingTopicTitleDraft(target.title);
    }
    setWritingManualContent("");
    void loadWritingTopicDetail(normalizedTopicId);
  }

  async function handleAppendWritingTopic(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingTopicIdDraft);
    if (!topicId) {
      args.setNotice({ type: "error", title: "请先输入合法 topicId" });
      return;
    }

    const content = writingAppendDraft.trim();
    if (!content) {
      args.setNotice({ type: "error", title: "append content 不能为空" });
      return;
    }

    const title = writingTopicTitleDraft.trim();
    setWritingActionState("append");
    try {
      const payload = await request<{ ok: boolean; result?: { topicId?: string } }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/append`, {
        method: "POST",
        body: JSON.stringify({
          content,
          ...(title ? { title } : {})
        })
      });
      const nextTopicId = normalizeWritingTopicId(payload.result?.topicId ?? topicId) || topicId;
      setWritingAppendDraft("");
      setWritingSelectedTopicId(nextTopicId);
      setWritingTopicIdDraft(nextTopicId);
      await loadWritingTopics({ preferredTopicId: nextTopicId });
      args.setNotice({ type: "success", title: `已追加内容到 topic: ${nextTopicId}` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "追加 writing 内容失败", text });
    } finally {
      setWritingActionState(null);
    }
  }

  async function handleSummarizeWritingTopic(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingSelectedTopicId || writingTopicIdDraft);
    if (!topicId) {
      args.setNotice({ type: "error", title: "请先选择或输入 topicId" });
      return;
    }

    setWritingActionState("summarize");
    try {
      await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/summarize`, {
        method: "POST",
        body: "{}"
      });
      await loadWritingTopics({ preferredTopicId: topicId });
      args.setNotice({ type: "success", title: `topic ${topicId} summarize 完成` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "执行 writing summarize 失败", text });
    } finally {
      setWritingActionState(null);
    }
  }

  async function handleRestoreWritingTopic(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingSelectedTopicId || writingTopicIdDraft);
    if (!topicId) {
      args.setNotice({ type: "error", title: "请先选择或输入 topicId" });
      return;
    }

    setWritingActionState("restore");
    try {
      await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/restore`, {
        method: "POST",
        body: "{}"
      });
      await loadWritingTopics({ preferredTopicId: topicId });
      args.setNotice({ type: "success", title: `topic ${topicId} 已恢复上一版` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "执行 writing restore 失败", text });
    } finally {
      setWritingActionState(null);
    }
  }

  async function handleSetWritingTopicState(): Promise<void> {
    const topicId = normalizeWritingTopicId(writingSelectedTopicId || writingTopicIdDraft);
    if (!topicId) {
      args.setNotice({ type: "error", title: "请先选择或输入 topicId" });
      return;
    }

    const content = writingManualContent.trim();
    if (!content) {
      args.setNotice({ type: "error", title: "手动 state 内容不能为空" });
      return;
    }

    setWritingActionState("set");
    try {
      await request<{ ok: boolean }>(`/admin/api/writing/topics/${encodeURIComponent(topicId)}/state`, {
        method: "POST",
        body: JSON.stringify({
          section: writingManualSection,
          content
        })
      });
      await loadWritingTopics({ preferredTopicId: topicId });
      args.setNotice({ type: "success", title: `topic ${topicId} 的 ${writingManualSection} 已更新` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "手动更新 writing state 失败", text });
    } finally {
      setWritingActionState(null);
    }
  }

  return {
    writingTopics,
    writingSelectedTopicId,
    writingTopicIdDraft,
    writingTopicTitleDraft,
    writingAppendDraft,
    writingTopicDetail,
    loadingWritingTopics,
    loadingWritingDetail,
    writingActionState,
    writingManualSection,
    writingManualContent,
    setWritingTopicIdDraft,
    setWritingTopicTitleDraft,
    setWritingAppendDraft,
    setWritingManualSection,
    setWritingManualContent,
    loadWritingTopics,
    handleWritingTopicSelect,
    handleAppendWritingTopic,
    handleSummarizeWritingTopic,
    handleRestoreWritingTopic,
    handleSetWritingTopicState
  };
}
