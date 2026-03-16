// @ts-nocheck
import { resolveAnalysisAssetType, isFundAnalysisEnabled } from "./analysis_router";
import { generateCodexMarkdownReport, shouldUseCodexMarkdownReport } from "./codex_markdown_report";
import { fetchOptionalNewsContext, generateExplanationByProvider, isExplanationEnabled } from "./explanation";
import { runFundAnalysis } from "./fund_analysis_service";
import { fetchMarketData, resolveIndexCodes } from "./marketData";
import { executeRuleEngine, calculateFeatureLayer } from "./signals";
import { persistRun, readAnalysisConfig, readPortfolio } from "./storage";

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
    try {
      const report = await generateCodexMarkdownReport({
        phase,
        portfolio,
        marketData,
        signalResult,
        optionalNewsContext,
        analysisEngine: analysisConfig.analysisEngine
      });

      if (report) {
        explanation = {
          summary: report.summary,
          provider: report.provider,
          model: report.model,
          generatedAt: report.generatedAt,
          markdown: report.markdown,
          inputPath: report.inputPath,
          outputPath: report.outputPath
        };
      }
    } catch (error) {
      explanation = {
        summary: "",
        error: (error && error.message) ? error.message : String(error || "unknown error"),
        generatedAt: new Date().toISOString(),
        provider: analysisConfig.analysisEngine
      };
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
