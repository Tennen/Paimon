import { MarketAnalysisAssetType, MarketAnalysisConfig } from "./fund/fund_types";

export function resolveAnalysisAssetType(input: {
  requestedAssetType?: string;
  analysisConfig: MarketAnalysisConfig;
}): MarketAnalysisAssetType {
  const requested = normalizeAssetType(input.requestedAssetType);
  if (requested) {
    return requested;
  }

  const configured = normalizeAssetType(input.analysisConfig.assetType);
  return configured || "equity";
}

export function isFundAnalysisEnabled(config: MarketAnalysisConfig): boolean {
  if (!config.fund.enabled) {
    return false;
  }

  const envFlag = String(process.env.ENABLE_FUND_ANALYSIS || "true").trim().toLowerCase();
  return envFlag !== "false" && envFlag !== "0" && envFlag !== "off";
}

function normalizeAssetType(input: unknown): MarketAnalysisAssetType | null {
  const value = String(input || "").trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (["fund", "基金"].includes(value)) {
    return "fund";
  }

  if (["equity", "stock", "股票", "a-share", "ashare"].includes(value)) {
    return "equity";
  }

  return null;
}
