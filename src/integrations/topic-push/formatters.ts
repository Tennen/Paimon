import { TOPIC_KEYS } from "./defaults";
import { formatLocalDate, formatLocalTime } from "./shared";
import { normalizeDigestLanguage } from "./planning";
import { sanitizeDigestTitle } from "./text";
import { DigestRunResult, TopicPushConfig, TopicPushSource, TopicPushState } from "./types";

export function formatSources(
  sources: TopicPushSource[],
  profile: { id: string; name: string }
): string {
  const sorted = sources.slice().sort((left, right) => left.id.localeCompare(right.id));
  const enabledCount = sorted.filter((item) => item.enabled).length;

  const lines = [
    `profile: ${profile.id} (${profile.name})`,
    `Topic Push RSS Sources (${enabledCount}/${sorted.length} enabled)`
  ];

  if (sorted.length === 0) {
    lines.push("(empty)");
    return lines.join("\n");
  }

  for (const source of sorted) {
    lines.push(
      `- ${source.id} | ${source.category} | ${source.enabled ? "on" : "off"} | w=${source.weight.toFixed(2)} | ${source.name}`,
      `  ${source.feedUrl}`
    );
  }

  return lines.join("\n");
}

export function formatConfig(
  config: TopicPushConfig,
  profile: { id: string; name: string }
): string {
  const topicStats = TOPIC_KEYS
    .map((key) => `${key}:${config.topics[key].length}`)
    .join(" ");

  return [
    "Topic Push Config",
    `profile: ${profile.id} (${profile.name})`,
    `summary_engine: ${config.summaryEngine}`,
    `default_language: ${config.defaultLanguage}`,
    `sources: ${config.sources.length} (enabled=${config.sources.filter((item) => item.enabled).length})`,
    `quota: total=${config.dailyQuota.total}, engineering=${config.dailyQuota.engineering}, news=${config.dailyQuota.news}, ecosystem=${config.dailyQuota.ecosystem}`,
    `filters: window=${config.filters.timeWindowHours}h, minTitleLength=${config.filters.minTitleLength}, maxPerDomain=${config.filters.maxPerDomain}`,
    `dedup: titleSimilarity=${config.filters.dedup.titleSimilarityThreshold.toFixed(2)}, urlNormalization=${config.filters.dedup.urlNormalization ? "on" : "off"}`,
    `blocked domains: ${config.filters.blockedDomains.join(", ") || "(none)"}`,
    `blocked title keywords: ${config.filters.blockedKeywordsInTitle.join(", ") || "(none)"}`,
    `topics: ${topicStats}`
  ].join("\n");
}

export function formatState(
  state: TopicPushState,
  profile: { id: string; name: string }
): string {
  const latest = state.sentLog[0];
  const latestText = latest
    ? `${formatLocalTime(latest.sentAt)} | ${latest.title} | ${latest.urlNormalized}`
    : "(none)";

  return [
    "Topic Push State",
    `profile: ${profile.id} (${profile.name})`,
    `sent_log_size: ${state.sentLog.length}`,
    `updated_at: ${state.updatedAt || "(empty)"}`,
    `latest: ${latestText}`
  ].join("\n");
}

export function formatDigest(
  run: DigestRunResult,
  profile: { id: string; name: string },
  targetLanguage: string
): string {
  const language = normalizeDigestLanguage(targetLanguage);
  const summaryLabel = language === "en" ? "Summary" : "简述";
  const emptyText = language === "en"
    ? "No new items were selected today. Use /topic source list to check sources, or /topic state clear to reset dedup history."
    : "今天没有筛出新的可推送条目。可用 /topic source list 检查源状态，或 /topic state clear 清空去重历史后重试。";
  const lines: string[] = [];
  lines.push(`${profile.name} Daily Digest (${formatLocalDate(run.now)})`);

  if (run.selected.length === 0) {
    lines.push(`\n${emptyText}`);
    return lines.join("\n");
  }

  for (const item of run.selected) {
    const cleanTitle = sanitizeDigestTitle(item.candidate.title, 180) || item.candidate.title;
    lines.push("");
    lines.push(`${item.rank}. ${cleanTitle}`);
    if (item.digestType === "deep_read" && item.digestSummary) {
      lines.push(`   ${summaryLabel}: ${item.digestSummary}`);
    }
    lines.push(`   ${item.candidate.url}`);
  }

  return lines.join("\n");
}

export function buildHelpText(): string {
  return [
    "Topic Push 用法",
    "- /topic 或 /topic run [--profile <id>] [--lang <zh-CN|en>]: 拉取 RSS 并生成该实体当日简报",
    "- /topic profile list|get|add|update|use|delete: 管理分组实体（profile）",
    "- /topic profile add --name \"AI Daily\" [--id ai-daily] [--clone-from ai-engineering]",
    "- /topic profile use <id>: 切换默认实体",
    "- /topic source list [--profile <id>]: 查看 RSS 源",
    "- /topic source get <id> [--profile <id>]: 查看单个源",
    "- /topic source add --name \"OpenAI Blog\" --category engineering --url https://openai.com/blog/rss.xml [--id openai-blog] [--weight 1.2] [--enabled true] [--profile <id>]",
    "- /topic source update <id> --name ... --category ... --url ... --weight ... --enabled true|false [--profile <id>]",
    "- /topic source enable <id> / disable <id> [--profile <id>]",
    "- /topic source delete <id> [--profile <id>]",
    "- /topic config [--profile <id>]: 查看筛选与配额配置",
    "- /topic state [--profile <id>]: 查看 sent log 状态",
    "- /topic state clear [--profile <id>]: 清空 sent log（允许重复推送历史链接）"
  ].join("\n");
}
