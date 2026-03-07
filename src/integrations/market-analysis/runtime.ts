// @ts-nocheck
import { fetchOptionalNewsContext, generateExplanationByProvider, isExplanationEnabled } from "./explanation";
import { fetchMarketData, resolveIndexCodes } from "./marketData";
import { executeRuleEngine, calculateFeatureLayer } from "./signals";
import { persistRun, readAnalysisConfig, readPortfolio } from "./storage";

export async function runAnalysis(phase, withExplanation) {
  const portfolio = readPortfolio();
  const analysisConfig = readAnalysisConfig();
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
