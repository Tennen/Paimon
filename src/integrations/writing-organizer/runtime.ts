import { WritingTopicMeta, WritingTopicState } from "./types";

export function buildSummarizedState(input: {
  meta: WritingTopicMeta;
  rawLines: string[];
  previousState: WritingTopicState;
  generatedAt: string;
}): WritingTopicState {
  const rawLines = input.rawLines.map((line) => line.trim()).filter((line) => line.length > 0);
  const keyPoints = pickKeyPoints(rawLines, 6);
  const latestPoints = rawLines.slice(-5);
  const intro = rawLines[0] ?? "";
  const ending = rawLines[rawLines.length - 1] ?? "";

  const summaryLines: string[] = [
    `# ${input.meta.title}`,
    `- topicId: ${input.meta.topicId}`,
    `- raw fragments: ${rawLines.length}`,
    `- generatedAt: ${input.generatedAt}`,
    "",
    "## 核心观察"
  ];

  if (keyPoints.length === 0) {
    summaryLines.push("- 暂无可用片段，请先 append 原始内容后再 summarize。");
  } else {
    for (let i = 0; i < keyPoints.length; i += 1) {
      summaryLines.push(`${i + 1}. ${keyPoints[i]}`);
    }
  }

  const outlineLines: string[] = [
    `# ${input.meta.title} 提纲`,
    "1. 开场：描述问题与场景",
    `   - ${intro || "从原始片段中提取背景"}`,
    "2. 关键观察：抽取主要观点",
    `   - ${keyPoints[0] ?? "补充观察点"}`,
    `   - ${keyPoints[1] ?? "补充观察点"}`,
    "3. 分析展开：解释原因与影响",
    `   - ${keyPoints[2] ?? "补充分析点"}`,
    `   - ${keyPoints[3] ?? "补充分析点"}`,
    "4. 结尾：收束并给出下一步",
    `   - ${ending || "补充结论"}`
  ];

  const draftLines: string[] = [
    `# ${input.meta.title}`,
    "",
    "## 背景",
    intro || "（等待补充背景）",
    "",
    "## 关键观点",
    ...(keyPoints.length > 0
      ? keyPoints.map((item) => `- ${item}`)
      : ["- （等待补充观点）"]),
    "",
    "## 最近片段",
    ...(latestPoints.length > 0
      ? latestPoints.map((item) => `- ${item}`)
      : ["- （暂无最近片段）"]),
    "",
    "## 收束",
    ending || "（等待补充结论）"
  ];

  if (input.previousState.draft.trim()) {
    const previousSnippet = takeFirstLines(input.previousState.draft, 4)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (previousSnippet.length > 0) {
      draftLines.push("", "## 上一版草稿片段", ...previousSnippet.map((line) => `> ${line}`));
    }
  }

  return {
    summary: summaryLines.join("\n"),
    outline: outlineLines.join("\n"),
    draft: draftLines.join("\n")
  };
}

function pickKeyPoints(rawLines: string[], limit: number): string[] {
  type Candidate = {
    text: string;
    normalized: string;
    count: number;
    firstIndex: number;
    lengthScore: number;
  };

  const map = new Map<string, Candidate>();

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const normalized = normalizeForScoring(line);
    if (!normalized) {
      continue;
    }

    const existing = map.get(normalized);
    if (existing) {
      existing.count += 1;
      continue;
    }

    map.set(normalized, {
      text: line,
      normalized,
      count: 1,
      firstIndex: i,
      lengthScore: Math.min(160, line.length)
    });
  }

  return Array.from(map.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (right.lengthScore !== left.lengthScore) {
        return right.lengthScore - left.lengthScore;
      }
      return left.firstIndex - right.firstIndex;
    })
    .slice(0, Math.max(1, limit))
    .map((item) => item.text);
}

function normalizeForScoring(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s,.;:!?，。；：！？、]/g, "");
}

function takeFirstLines(text: string, maxLines: number): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .slice(0, Math.max(0, maxLines));
}
