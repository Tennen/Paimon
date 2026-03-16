import {
  WritingAppendResult,
  WritingRestoreResult,
  WritingStateSection,
  WritingSummarizeResult,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicState
} from "./types";

export function buildHelpText(): string {
  return [
    "Incremental Writing Organizer 用法",
    "- /writing topics: 查看 topic 列表",
    "- /writing show <topic-id>: 查看 meta + state + backup + raw 文件统计 + Material/Insight/Document 产物统计",
    "- /writing append <topic-id> \"一段新内容\": 追加原始片段并生成 Material",
    "- /writing summarize <topic-id> [--mode knowledge_entry|article|memo|research_note]: 先备份当前 state，再执行 Material -> Insight -> Document 生成",
    "- /writing restore <topic-id>: 从 backup 恢复上一版 state",
    "- /writing set <topic-id> <summary|outline|draft> \"内容\": 手动更新某个 state 文件",
    "",
    "示例:",
    "- /writing append relationship-boundaries \"很多时候痛苦来自误判，而不是拒绝\"",
    "- /writing summarize relationship-boundaries",
    "- /writing show relationship-boundaries"
  ].join("\n");
}

export function formatTopicList(topics: WritingTopicMeta[]): string {
  if (topics.length === 0) {
    return [
      "暂无 writing topic。",
      "可先执行: /writing append <topic-id> \"一段新内容\""
    ].join("\n");
  }

  const lines = ["Writing Topics"]; 
  for (const topic of topics) {
    lines.push(
      `- ${topic.topicId} | ${topic.title} | status=${topic.status} | raw=${topic.rawFileCount} files / ${topic.rawLineCount} lines | summarized=${topic.lastSummarizedAt ?? "(never)"}`
    );
  }
  return lines.join("\n");
}

export function formatTopicDetail(detail: WritingTopicDetail): string {
  const rawLines = detail.rawFiles
    .map((file) => `- ${file.name}: ${file.lineCount} lines`)
    .join("\n") || "- (empty)";

  const artifactLines = detail.artifacts
    ? [
      `Materials: ${detail.artifacts.materialCount}`,
      `Insights: ${detail.artifacts.insightCount}`,
      `Documents: ${detail.artifacts.documentCount}`,
      `Latest Insight: ${detail.artifacts.latestInsight?.id ?? "(none)"}`,
      `Latest Document: ${detail.artifacts.latestDocument?.id ?? "(none)"}${detail.artifacts.latestDocument ? ` @ ${detail.artifacts.latestDocument.path}` : ""}`
    ]
    : ["Materials: 0", "Insights: 0", "Documents: 0"];

  return [
    `Topic: ${detail.meta.topicId}`,
    `Title: ${detail.meta.title}`,
    `Status: ${detail.meta.status}`,
    `Raw: ${detail.meta.rawFileCount} files / ${detail.meta.rawLineCount} lines`,
    `Last Summarized: ${detail.meta.lastSummarizedAt ?? "(never)"}`,
    "",
    "State Preview:",
    formatStatePreview(detail.state),
    "",
    "Backup Preview:",
    formatStatePreview(detail.backup),
    "",
    "Artifacts:",
    artifactLines.join("\n"),
    "",
    "Raw Files:",
    rawLines
  ].join("\n");
}

export function formatAppendResult(result: WritingAppendResult): string {
  return [
    `已追加 ${result.appendedLines} 行到 topic ${result.topicId}`,
    `当前 raw 文件: ${result.latestRawFile}`,
    `raw 统计: ${result.meta.rawFileCount} files / ${result.meta.rawLineCount} lines`,
    `material: ${result.materialIds?.join(", ") ?? "(none)"}`
  ].join("\n");
}

export function formatSummarizeResult(result: WritingSummarizeResult): string {
  return [
    `topic ${result.topicId} summarize 完成`,
    `生成时间: ${result.generatedAt}`,
    `raw 行数: ${result.rawLineCount}`,
    `material 数量: ${result.materialCount ?? 0}`,
    `文档模式: ${result.mode ?? "knowledge_entry"}`,
    `文档路径: ${result.document?.path ?? "(none)"}`,
    "",
    "Summary Preview:",
    previewText(result.state.summary),
    "",
    "Outline Preview:",
    previewText(result.state.outline),
    "",
    "Draft Preview:",
    previewText(result.state.draft)
  ].join("\n");
}

export function formatRestoreResult(result: WritingRestoreResult): string {
  return [
    `topic ${result.topicId} 已恢复到上一版 backup`,
    `raw 统计: ${result.meta.rawFileCount} files / ${result.meta.rawLineCount} lines`,
    "",
    "Draft Preview:",
    previewText(result.state.draft)
  ].join("\n");
}

export function formatSetStateResult(topicId: string, section: WritingStateSection, state: WritingTopicState): string {
  const value = state[section];
  return [
    `topic ${topicId} 的 ${section} 已更新`,
    previewText(value)
  ].join("\n");
}

function formatStatePreview(state: WritingTopicState): string {
  return [
    `summary: ${previewInline(state.summary)}`,
    `outline: ${previewInline(state.outline)}`,
    `draft: ${previewInline(state.draft)}`
  ].join("\n");
}

function previewInline(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty)";
  }
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 120)}...`;
}

function previewText(input: string): string {
  const lines = input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8);

  if (lines.length === 0) {
    return "(empty)";
  }
  return lines.join("\n");
}
