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
    "- /writing show <topic-id>: 查看 meta + state + backup + raw 文件统计",
    "- /writing append <topic-id> \"一段新内容\": 追加原始片段（raw rolling，单文件最多 200 行）",
    "- /writing summarize <topic-id>: 先备份当前 state，再生成新的 summary/outline/draft",
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
    "Raw Files:",
    rawLines
  ].join("\n");
}

export function formatAppendResult(result: WritingAppendResult): string {
  return [
    `已追加 ${result.appendedLines} 行到 topic ${result.topicId}`,
    `当前 raw 文件: ${result.latestRawFile}`,
    `raw 统计: ${result.meta.rawFileCount} files / ${result.meta.rawLineCount} lines`
  ].join("\n");
}

export function formatSummarizeResult(result: WritingSummarizeResult): string {
  return [
    `topic ${result.topicId} summarize 完成`,
    `生成时间: ${result.generatedAt}`,
    `raw 行数: ${result.rawLineCount}`,
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
