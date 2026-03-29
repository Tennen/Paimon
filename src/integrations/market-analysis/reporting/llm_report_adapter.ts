import { resolveDataPath } from "../../../storage/persistence";
import {
  appendFundDashboardSection,
  appendMarketErrorsSection,
  appendNewsSection,
  appendPortfolioSection,
  appendSignalSection
} from "./llm_report_adapter_sections";
import {
  formatMarketStateLabel,
  formatPhaseLabel,
  normalizeText,
  resolveTimeoutOverride
} from "./llm_report_adapter_format";
import { isCodexProvider, runCodexMarkdownReport } from "../../codex/markdownReport";
import type { RunFundAnalysisOutput } from "../fund/fund_analysis_service";
import type { FundAnalysisOutput, MarketPhase, MarketPortfolio } from "../fund/fund_types";

export type MarketReportPayload = {
  phase: MarketPhase;
  portfolio: MarketPortfolio;
  marketData: RunFundAnalysisOutput["marketData"];
  signalResult: FundAnalysisOutput;
  optionalNewsContext: RunFundAnalysisOutput["optionalNewsContext"];
  analysisEngine: string;
};

export type MarketLlmReport = {
  provider: "codex";
  model: string;
  summary: string;
  markdown: string;
  generatedAt: string;
  inputPath: string;
  outputPath: string;
};

const REPORT_DIR = resolveDataPath("market-analysis", "llm-reports");

export function shouldUseLlmReport(engineRaw: unknown): boolean {
  return isCodexProvider(engineRaw);
}

export async function generateMarketLlmReport(input: MarketReportPayload): Promise<MarketLlmReport | null> {
  const sourceMarkdown = buildMarketReportSourceMarkdown(input);
  const timeoutOverride = resolveTimeoutOverride(process.env.MARKET_ANALYSIS_LLM_TIMEOUT_MS);

  return runCodexMarkdownReport({
    providerRaw: input.analysisEngine,
    taskPrefix: input.phase,
    sourceMarkdown,
    systemPrompt: buildMarketReportSystemPrompt(),
    userPrompt: "请阅读这份市场上下文 markdown，并输出完整分析报告。",
    outputDir: REPORT_DIR,
    modelOverride: normalizeText(process.env.MARKET_ANALYSIS_LLM_MODEL),
    ...(timeoutOverride ? { timeoutMs: timeoutOverride } : {})
  });
}

export function buildMarketReportSystemPrompt(): string {
  return [
    "你是市场策略分析助理，请只输出中文 markdown 报告。",
    "不要输出 JSON，不要输出代码块围栏，不要额外解释。",
    "报告必须可直接发给投资者阅读，语言自然、克制、可执行。",
    "默认面向手机端阅读：段落尽量短，每段控制在 1-3 句。",
    "正文优先使用自然语言，不要堆砌字段名、枚举值、变量名或调试口径。",
    "把输入视为基金持仓日报素材包，分析架构尽量贴近“决策仪表盘”：核心结论、数据视角、情报观察、执行计划。",
    "优先使用二级/三级标题和短 bullet，避免连续大段文字。",
    "持仓逐项建议中，每个标的都按“核心结论 / 数据视角 / 情报观察 / 执行计划”四段展开，再补充结构化表格。",
    "每个标的的“数据视角”必须尽量保留输入里已有的关键数字，至少覆盖净值快照、收益表现、风险刻画、相对表现；有值就保留，不要为了简短主动省略。",
    "如果输入已给出多项数据，请优先完整呈现，再下结论；不要只保留 1-2 个指标代替整张数据视角。",
    "必须严格保持输入里的信号方向和决策动作，不得反转或改写原始信号。",
    "对于结构化数据，请在\"持仓逐项建议\"中补充 markdown 表格，列名使用中文，指标名称改成人能读懂的表达；宽表最多 4 列，超过时拆成多段短列表。",
    "sentiment_score、confidence、rule_adjusted_score、blocked_actions、rule_flags 是内部校准口径，最终面向投资者的文字里不要原样复述数字或英文 code，要改写成“信号偏强”“证据支撑一般”“存在申购赎回限制”等自然表达。",
    "除专有名词（如 ETF、LOF、Search Engine 名称）外，尽量保持中文表达一致，避免中英文混写。",
    "高风险或强约束内容请使用 quote（>）或加粗强调。",
    "关键信号值需转换为人类可读语言：",
    "- 决策动作: BUY→买入, ADD→加仓, HOLD→持有, REDUCE→减仓, REDEEM→赎回, WATCH→观察",
    "- 市场状态: MARKET_STRONG→偏强, MARKET_WEAK→偏弱, MARKET_NEUTRAL→中性",
    "- 阶段: midday→盘中, close→收盘",
    "- 特征覆盖: ok→完整, partial→部分可用, insufficient→不足",
    "请按以下结构输出：",
    "# 今日结论",
    "## 市场状态",
    "## 持仓逐项建议",
    "## 风险与观察点",
    "## 执行清单（短期/中期）"
  ].join("\n");
}

export function buildMarketReportSourceMarkdown(input: MarketReportPayload): string {
  const signalResult = input.signalResult;
  const portfolio = input.portfolio;
  const marketData = input.marketData;
  const optionalNews = input.optionalNewsContext;

  const lines: string[] = [
    "# 市场分析上下文",
    "",
    `- 运行阶段: ${formatPhaseLabel(normalizeText(input.phase))}`,
    "- 资产类型: 基金",
    `- 市场状态: ${formatMarketStateLabel(normalizeText(signalResult.marketState))}`,
    `- 相对参照: ${normalizeText(signalResult.comparisonReference) || "-"}`,
    `- 生成时间: ${normalizeText(signalResult.generatedAt) || new Date().toISOString()}`,
    ""
  ];

  appendPortfolioSection(lines, portfolio);
  appendSignalSection(lines, signalResult);
  appendFundDashboardSection(lines, signalResult, marketData);
  appendMarketErrorsSection(lines, marketData);
  appendNewsSection(lines, optionalNews);
  return lines.join("\n").trim();
}
