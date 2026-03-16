// @ts-nocheck
import { resolveAnalysisAssetType, isFundAnalysisEnabled } from "./analysis_router";
import { generateCodexMarkdownReport, shouldUseCodexMarkdownReport } from "./codex_markdown_report";
import { fetchOptionalNewsContext, generateExplanationByProvider, isExplanationEnabled } from "./explanation";
import { runFundAnalysis } from "./fund_analysis_service";
import { fetchMarketData, resolveIndexCodes } from "./marketData";
import { executeRuleEngine, calculateFeatureLayer } from "./signals";
import { persistRun, readAnalysisConfig, readPortfolio } from "./storage";

const MARKET_IMAGE_PIPELINE_FAILED = "MARKET_IMAGE_PIPELINE_FAILED";

export async function runAnalysis(phase, withExplanation, options = {}) {
  const portfolio = readPortfolio();
  const analysisConfig = readAnalysisConfig();
  const assetType = resolveAnalysisAssetType({
    requestedAssetType: options.assetType,
    analysisConfig
  });
  const explanationEnabled = withExplanation && isExplanationEnabled();
  const useCodexMarkdownBatch = explanationEnabled && shouldUseCodexMarkdownReport(analysisConfig.analysisEngine);
  const useNativeExplanation = explanationEnabled && !useCodexMarkdownBatch;
  if (withExplanation && !useCodexMarkdownBatch) {
    throw createMarketImagePipelineError("markdown report pipeline requires codex analysis engine");
  }

  let marketData = null;
  let signalResult = null;
  let explanation = null;
  let optionalNewsContext = null;

  if (assetType === "fund" && isFundAnalysisEnabled(analysisConfig)) {
    try {
      const fundResult = await runFundAnalysis({
        phase,
        withExplanation: useNativeExplanation,
        portfolio,
        analysisConfig
      });

      marketData = fundResult.marketData;
      signalResult = fundResult.signalResult;
      explanation = fundResult.explanation;
      optionalNewsContext = fundResult.optionalNewsContext;
    } catch (error) {
      const detail = (error && error.message) ? error.message : String(error || "unknown error");
      const now = new Date().toISOString();
      marketData = {
        assetType: "fund",
        generatedAt: now,
        funds: [],
        source_chain: ["fund_runtime:fallback"],
        errors: [detail]
      };
      signalResult = {
        phase,
        marketState: "MARKET_NEUTRAL",
        benchmark: "",
        generatedAt: now,
        assetType: "fund",
        assetSignals: portfolio.funds.map((item) => ({
          code: item.code,
          signal: "WATCH"
        })),
        fund_dashboards: [],
        portfolio_report: {
          brief: "基金流程执行失败，已降级为 watch。",
          full: `fund runtime failed: ${detail}`
        },
        audit: {
          steps: [],
          errors: [detail]
        }
      };
      explanation = {
        summary: "基金流程执行失败，已降级为 watch。",
        provider: "rule_template",
        generatedAt: now,
        dashboards: [],
        error: detail
      };
      optionalNewsContext = null;
    }
  } else {
    const equityResult = await runLegacyEquityAnalysis(phase, useNativeExplanation, portfolio, analysisConfig);
    marketData = equityResult.marketData;
    signalResult = equityResult.signalResult;
    explanation = equityResult.explanation;
    optionalNewsContext = equityResult.optionalNewsContext;
  }

  if (useCodexMarkdownBatch) {
    let report = null;
    try {
      report = await generateCodexMarkdownReport({
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

    const markdown = String(report && report.markdown || "").trim();
    if (!report || !markdown) {
      throw createMarketImagePipelineError("markdown report is required when explanation is enabled");
    }

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
    const markdown = String(explanation && explanation.markdown || "").trim();
    if (!markdown) {
      throw createMarketImagePipelineError("markdown report is required when explanation is enabled");
    }
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

async function runLegacyEquityAnalysis(phase, withExplanation, portfolio, analysisConfig) {
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

  let explanation = null;
  if (withExplanation && isExplanationEnabled()) {
    try {
      explanation = await generateExplanationByProvider(
        signalResult,
        optionalNewsContext,
        analysisConfig
      );
    } catch (error) {
      explanation = {
        summary: "",
        error: (error && error.message) ? error.message : String(error || "unknown error"),
        generatedAt: new Date().toISOString(),
        provider: analysisConfig.analysisEngine
      };
    }
  }

  return {
    marketData,
    signalResult,
    explanation,
    optionalNewsContext
  };
}

function createMarketImagePipelineError(reason, cause) {
  const detail = String(reason || "unknown error").trim() || "unknown error";
  const error = new Error(`${MARKET_IMAGE_PIPELINE_FAILED}: ${detail}`);
  error.code = MARKET_IMAGE_PIPELINE_FAILED;
  if (cause) {
    error.cause = cause;
  }
  return error;
}
