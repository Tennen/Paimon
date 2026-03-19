// @ts-nocheck
import { runFundAnalysis } from "./fund/fund_analysis_service";
import { generateMarketLlmReport, shouldUseLlmReport } from "./reporting/llm_report_adapter";
import { requireExplanationMarkdown } from "./reporting/markdown_output_adapter";
import { createMarketImagePipelineError } from "./reporting/pipeline_errors";
import { persistRun, readAnalysisConfig, readPortfolio } from "./storage";

export async function runAnalysis(phase, withExplanation) {
  const portfolio = readPortfolio();
  const analysisConfig = readAnalysisConfig();
  const explanationEnabled = withExplanation && isLlmExplanationEnabled();
  const useBatchMarkdownReport = explanationEnabled && shouldUseLlmReport(analysisConfig.analysisEngine);
  if (withExplanation && !useBatchMarkdownReport) {
    throw createMarketImagePipelineError("markdown report pipeline requires codex analysis engine");
  }
  if (!isFundAnalysisEnabled(analysisConfig)) {
    throw new Error("market-analysis currently supports fund analysis only, but fund flow is disabled");
  }

  const analysisResult = await runFundAnalysis({
    phase,
    withExplanation: false,
    portfolio,
    analysisConfig
  });

  let marketData = analysisResult.marketData;
  let signalResult = analysisResult.signalResult;
  let explanation = analysisResult.explanation;
  const optionalNewsContext = analysisResult.optionalNewsContext;

  if (useBatchMarkdownReport) {
    let report = null;
    try {
      report = await generateMarketLlmReport({
        phase,
        portfolio,
        marketData,
        signalResult,
        optionalNewsContext,
        analysisEngine: analysisConfig.analysisEngine
      });
    } catch (error) {
      const detail = (error && error.message) ? error.message : String(error || "unknown error");
      throw createMarketImagePipelineError(`failed to generate markdown report: ${detail}`, error);
    }

    const markdown = requireExplanationMarkdown(report);

    explanation = {
      summary: report.summary,
      provider: report.provider,
      model: report.model,
      generatedAt: report.generatedAt,
      markdown,
      inputPath: report.inputPath,
      outputPath: report.outputPath
    };
  }

  if (withExplanation) {
    requireExplanationMarkdown(explanation);
  }

  const persisted = persistRun({
    phase,
    portfolio,
    marketData,
    signalResult,
    explanation,
    optionalNewsContext
  });

  return {
    phase,
    portfolio,
    marketData,
    signalResult,
    explanation,
    persisted
  };
}

function isLlmExplanationEnabled() {
  const flag = String(process.env.MARKET_ANALYSIS_LLM_ENABLED || "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

function isFundAnalysisEnabled(config) {
  if (!config.fund.enabled) {
    return false;
  }

  const envFlag = String(process.env.ENABLE_FUND_ANALYSIS || "true").trim().toLowerCase();
  return envFlag !== "false" && envFlag !== "0" && envFlag !== "off";
}
