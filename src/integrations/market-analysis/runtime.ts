// @ts-nocheck
import { resolveAnalysisAssetType, isFundAnalysisEnabled } from "./analysis_router";
import { fetchOptionalNewsContext } from "./equity/news_context";
import { runFundAnalysis } from "./fund/fund_analysis_service";
import { fetchMarketData, resolveIndexCodes } from "./equity/marketData";
import { executeRuleEngine, calculateFeatureLayer } from "./equity/signals";
import { generateMarketLlmReport, shouldUseLlmReport } from "./reporting/llm_report_adapter";
import { requireExplanationMarkdown } from "./reporting/markdown_output_adapter";
import { createMarketImagePipelineError } from "./reporting/pipeline_errors";
import { persistRun, readAnalysisConfig, readPortfolio } from "./storage";

export async function runAnalysis(phase, withExplanation, options = {}) {
  const portfolio = readPortfolio();
  const analysisConfig = readAnalysisConfig();
  const assetType = resolveAnalysisAssetType({
    requestedAssetType: options.assetType,
    analysisConfig
  });
  const explanationEnabled = withExplanation && isLlmExplanationEnabled();
  const useBatchMarkdownReport = explanationEnabled && shouldUseLlmReport(analysisConfig.analysisEngine);
  if (withExplanation && !useBatchMarkdownReport) {
    throw createMarketImagePipelineError("markdown report pipeline requires codex analysis engine");
  }

  const analysisResult = assetType === "fund" && isFundAnalysisEnabled(analysisConfig)
    ? await runFundAnalysis({
        phase,
        withExplanation: false,
        portfolio,
        analysisConfig
      })
    : await runLegacyEquityAnalysis(phase, portfolio);

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

async function runLegacyEquityAnalysis(phase, portfolio) {
  const assetCodes = Array.from(new Set(portfolio.funds.map((item) => item.code)));
  const indexCodes = resolveIndexCodes();

  const marketData = await fetchMarketData({
    assetCodes,
    indexCodes
  });

  const featureLayer = calculateFeatureLayer(marketData);
  const signalResult = executeRuleEngine({
    phase,
    portfolio,
    marketData,
    featureLayer
  });

  const optionalNewsContext = await fetchOptionalNewsContext();

  return {
    marketData,
    signalResult,
    explanation: null,
    optionalNewsContext
  };
}

function isLlmExplanationEnabled() {
  const flag = String(process.env.MARKET_ANALYSIS_LLM_ENABLED || "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}
