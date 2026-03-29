import { useEffect, useMemo, useState } from "react";
import type {
  LLMProviderStore,
  MarketAnalysisConfig,
  MarketAnalysisEngine,
  MarketConfig,
  MarketFundHolding,
  MarketFundRiskLevel,
  MarketPortfolio,
  MarketPortfolioImportResponse,
  MarketSecuritySearchItem,
  Notice,
  SearchEngineStore
} from "@/types/admin";
import { DEFAULT_MARKET_ANALYSIS_CONFIG, DEFAULT_MARKET_PORTFOLIO } from "@/types/admin";
import { request } from "./adminApi";
import {
  isSameMarketFund,
  isValidMarketFund,
  normalizeMarketAnalysisConfig,
  normalizeMarketFund,
  normalizeMarketPortfolio,
  resizeSavedFundsArray,
  resizeSearchResultsArray,
  resizeStringArray,
  resolveMarketAnalysisProviderId,
  resolveMarketSearchEngineId,
  toMarketErrorText
} from "./marketAdminUtils";

type NoticeSetter = React.Dispatch<React.SetStateAction<Notice>>;

type UseMarketPortfolioStateArgs = {
  llmProviderStore: LLMProviderStore | null;
  marketSearchEngineStore: SearchEngineStore | null;
  setNotice: NoticeSetter;
};

type LoadMarketConfigOptions = {
  llmProviderStore?: LLMProviderStore | null;
  marketSearchEngineStore?: SearchEngineStore | null;
};

export function useMarketPortfolioState(args: UseMarketPortfolioStateArgs) {
  const [marketConfig, setMarketConfig] = useState<MarketConfig | null>(null);
  const [marketPortfolio, setMarketPortfolio] = useState<MarketPortfolio>(DEFAULT_MARKET_PORTFOLIO);
  const [marketAnalysisConfig, setMarketAnalysisConfig] = useState<MarketAnalysisConfig>(DEFAULT_MARKET_ANALYSIS_CONFIG);
  const [savingMarketPortfolio, setSavingMarketPortfolio] = useState(false);
  const [savingMarketAnalysisConfig, setSavingMarketAnalysisConfig] = useState(false);
  const [savingMarketFundIndex, setSavingMarketFundIndex] = useState<number | null>(null);
  const [marketSavedFundsByRow, setMarketSavedFundsByRow] = useState<Array<MarketFundHolding | null>>([]);
  const [marketSavedCash, setMarketSavedCash] = useState(0);
  const [marketBatchCodesInput, setMarketBatchCodesInput] = useState("");
  const [importingMarketCodes, setImportingMarketCodes] = useState(false);
  const [marketSearchInputs, setMarketSearchInputs] = useState<string[]>([]);
  const [marketSearchResults, setMarketSearchResults] = useState<MarketSecuritySearchItem[][]>([]);
  const [searchingMarketFundIndex, setSearchingMarketFundIndex] = useState<number | null>(null);

  const marketFundSaveStates = useMemo<Array<"saved" | "dirty" | "saving">>(() => {
    return marketPortfolio.funds.map((fund, index) => {
      if (savingMarketFundIndex === index) {
        return "saving";
      }
      const saved = marketSavedFundsByRow[index];
      if (!saved) {
        return "dirty";
      }
      return isSameMarketFund(normalizeMarketFund(saved), normalizeMarketFund(fund)) ? "saved" : "dirty";
    });
  }, [marketPortfolio.funds, marketSavedFundsByRow, savingMarketFundIndex]);

  useEffect(() => {
    setMarketAnalysisConfig((prev) => {
      const nextAnalysisEngine = resolveMarketAnalysisProviderId(prev.analysisEngine, args.llmProviderStore);
      const nextSearchEngine = resolveMarketSearchEngineId(prev.searchEngine, args.marketSearchEngineStore);
      if (nextAnalysisEngine === prev.analysisEngine && nextSearchEngine === prev.searchEngine) {
        return prev;
      }
      return {
        ...prev,
        analysisEngine: nextAnalysisEngine,
        searchEngine: nextSearchEngine
      };
    });
  }, [args.llmProviderStore, args.marketSearchEngineStore]);

  useEffect(() => {
    const nextLength = marketPortfolio.funds.length;
    setMarketSearchInputs((prev) => resizeStringArray(prev, nextLength));
    setMarketSearchResults((prev) => resizeSearchResultsArray(prev, nextLength));
  }, [marketPortfolio.funds.length]);

  function applyPortfolioSnapshot(portfolio: MarketPortfolio): void {
    setMarketPortfolio(portfolio);
    setMarketSavedFundsByRow(portfolio.funds.map((fund) => ({ ...fund })));
    setMarketSavedCash(portfolio.cash);
  }

  async function loadMarketConfig(options?: LoadMarketConfigOptions): Promise<void> {
    const payload = await request<MarketConfig>("/admin/api/market/config");
    const portfolio = normalizeMarketPortfolio(payload.portfolio ?? DEFAULT_MARKET_PORTFOLIO);
    const analysisConfigRaw = normalizeMarketAnalysisConfig(payload.config ?? DEFAULT_MARKET_ANALYSIS_CONFIG);
    setMarketConfig(payload);
    applyPortfolioSnapshot(portfolio);
    setMarketAnalysisConfig({
      ...analysisConfigRaw,
      analysisEngine: resolveMarketAnalysisProviderId(
        analysisConfigRaw.analysisEngine,
        options?.llmProviderStore ?? args.llmProviderStore
      ),
      searchEngine: resolveMarketSearchEngineId(
        analysisConfigRaw.searchEngine,
        options?.marketSearchEngineStore ?? args.marketSearchEngineStore
      )
    });
  }

  function handleAddMarketFund(): void {
    setMarketPortfolio((prev) => ({ ...prev, funds: prev.funds.concat([{ code: "", name: "" }]) }));
    setMarketSavedFundsByRow((prev) => prev.concat(null));
    setMarketSearchInputs((prev) => prev.concat(""));
    setMarketSearchResults((prev) => prev.concat([[]]));
  }

  function handleRemoveMarketFund(index: number): void {
    setMarketPortfolio((prev) => ({ ...prev, funds: prev.funds.filter((_, idx) => idx !== index) }));
    setMarketSavedFundsByRow((prev) => prev.filter((_, idx) => idx !== index));
    setMarketSearchInputs((prev) => prev.filter((_, idx) => idx !== index));
    setMarketSearchResults((prev) => prev.filter((_, idx) => idx !== index));
    setSearchingMarketFundIndex((prev) => (prev === null || prev === index ? null : prev > index ? prev - 1 : prev));
    setSavingMarketFundIndex((prev) => (prev === null || prev === index ? null : prev > index ? prev - 1 : prev));
  }

  function handleMarketCashChange(value: number): void {
    setMarketPortfolio((prev) => ({ ...prev, cash: Number.isFinite(value) ? value : 0 }));
  }

  function handleMarketAnalysisEngineChange(value: MarketAnalysisEngine): void {
    setMarketAnalysisConfig((prev) => ({ ...prev, analysisEngine: value }));
  }

  function handleMarketSearchEngineChange(value: string): void {
    setMarketAnalysisConfig((prev) => ({ ...prev, searchEngine: value }));
  }

  function handleMarketGptPluginTimeoutMsChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      gptPlugin: { ...prev.gptPlugin, timeoutMs: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0 }
    }));
  }

  function handleMarketGptPluginFallbackToLocalChange(value: boolean): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      gptPlugin: { ...prev.gptPlugin, fallbackToLocal: value }
    }));
  }

  function handleMarketFundEnabledChange(value: boolean): void {
    setMarketAnalysisConfig((prev) => ({ ...prev, fund: { ...prev.fund, enabled: value } }));
  }

  function handleMarketFundMaxAgeDaysChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: { ...prev.fund, maxAgeDays: Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1 }
    }));
  }

  function handleMarketFundFeatureLookbackDaysChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: { ...prev.fund, featureLookbackDays: Number.isFinite(value) ? Math.max(20, Math.floor(value)) : 20 }
    }));
  }

  function handleMarketFundRiskLevelChange(value: MarketFundRiskLevel): void {
    setMarketAnalysisConfig((prev) => ({ ...prev, fund: { ...prev.fund, ruleRiskLevel: value } }));
  }

  function handleMarketFundLlmRetryMaxChange(value: number): void {
    setMarketAnalysisConfig((prev) => ({
      ...prev,
      fund: { ...prev.fund, llmRetryMax: Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1 }
    }));
  }

  function handleMarketFundNewsQuerySuffixChange(value: string): void {
    setMarketAnalysisConfig((prev) => ({ ...prev, fund: { ...prev.fund, newsQuerySuffix: String(value || "") } }));
  }

  function handleMarketFundChange(index: number, key: keyof MarketFundHolding, value: string): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      funds: prev.funds.map((fund, rowIndex) => {
        if (rowIndex !== index) {
          return fund;
        }
        if (key === "code" || key === "name") {
          return { ...fund, [key]: value };
        }
        const trimmed = value.trim();
        const numeric = Number(trimmed);
        if (!trimmed) {
          return { ...fund, ...(key === "quantity" ? { quantity: undefined } : { avgCost: undefined }) };
        }
        return key === "quantity"
          ? { ...fund, quantity: Number.isFinite(numeric) && numeric > 0 ? numeric : undefined }
          : { ...fund, avgCost: Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined };
      })
    }));
  }

  function handleMarketSearchInputChange(index: number, value: string): void {
    setMarketSearchInputs((prev) => {
      const next = resizeStringArray(prev, marketPortfolio.funds.length).slice();
      if (index >= 0 && index < next.length) {
        next[index] = value;
      }
      return next;
    });
  }

  async function handleSearchMarketByName(index: number): Promise<void> {
    const keyword = (marketSearchInputs[index] ?? "").trim();
    if (!keyword) {
      args.setNotice({ type: "error", title: "请输入名称后再查找" });
      return;
    }

    setSearchingMarketFundIndex(index);
    try {
      const payload = await request<{ keyword: string; items: MarketSecuritySearchItem[] }>(
        `/admin/api/market/securities/search?keyword=${encodeURIComponent(keyword)}&limit=8`
      );
      const items = Array.isArray(payload.items) ? payload.items : [];
      setMarketSearchResults((prev) => {
        const next = resizeSearchResultsArray(prev, marketPortfolio.funds.length).slice();
        if (index >= 0 && index < next.length) {
          next[index] = items;
        }
        return next;
      });
      if (items.length === 0) {
        args.setNotice({ type: "info", title: `未找到“${keyword}”相关代码` });
      }
    } catch (error) {
      args.setNotice({ type: "error", title: "名称查找 code 失败", text: toMarketErrorText(error) });
    } finally {
      setSearchingMarketFundIndex((prev) => (prev === index ? null : prev));
    }
  }

  function handleApplyMarketSearchResult(index: number, item: MarketSecuritySearchItem): void {
    setMarketPortfolio((prev) => ({
      ...prev,
      funds: prev.funds.map((fund, rowIndex) => (rowIndex === index ? { ...fund, code: item.code, name: item.name } : fund))
    }));
    setMarketSearchInputs((prev) => {
      const next = resizeStringArray(prev, marketPortfolio.funds.length).slice();
      if (index >= 0 && index < next.length) {
        next[index] = item.name;
      }
      return next;
    });
    setMarketSearchResults((prev) => {
      const next = resizeSearchResultsArray(prev, marketPortfolio.funds.length).slice();
      if (index >= 0 && index < next.length) {
        next[index] = [];
      }
      return next;
    });
  }

  async function handleSaveMarketFund(index: number): Promise<void> {
    if (savingMarketPortfolio || savingMarketFundIndex !== null) {
      return;
    }
    const fund = marketPortfolio.funds[index];
    const target = fund ? normalizeMarketFund(fund) : null;
    if (!target || !isValidMarketFund(target)) {
      args.setNotice({ type: "error", title: "请先填写合法代码后再保存该行" });
      return;
    }

    const funds = marketPortfolio.funds
      .map((_, rowIndex) => (rowIndex === index ? target : marketSavedFundsByRow[rowIndex]))
      .filter((item): item is MarketFundHolding => item !== null && isValidMarketFund(item))
      .map((item) => normalizeMarketFund(item));

    setSavingMarketFundIndex(index);
    try {
      const response = await request<{ ok: boolean; portfolio: MarketPortfolio }>("/admin/api/market/config", {
        method: "PUT",
        body: JSON.stringify({ portfolio: { funds, cash: marketSavedCash } })
      });
      const nextPortfolio = normalizeMarketPortfolio(response.portfolio);
      setMarketPortfolio((prev) => ({
        ...prev,
        funds: prev.funds.map((item, rowIndex) => (rowIndex === index ? target : item))
      }));
      setMarketSavedFundsByRow((prev) => {
        const next = resizeSavedFundsArray(prev, marketPortfolio.funds.length).slice();
        if (index >= 0 && index < next.length) {
          next[index] = { ...target };
        }
        return next;
      });
      setMarketSavedCash(nextPortfolio.cash);
      args.setNotice({ type: "success", title: "该行持仓已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存该行持仓失败", text: toMarketErrorText(error) });
    } finally {
      setSavingMarketFundIndex((current) => (current === index ? null : current));
    }
  }

  async function handleSaveMarketPortfolio(): Promise<void> {
    if (savingMarketFundIndex !== null || savingMarketAnalysisConfig) {
      return;
    }

    const payload: MarketPortfolio = {
      funds: marketPortfolio.funds.map((fund) => normalizeMarketFund(fund)).filter((fund) => isValidMarketFund(fund)),
      cash: Number.isFinite(Number(marketPortfolio.cash)) && Number(marketPortfolio.cash) > 0 ? Number(marketPortfolio.cash) : 0
    };

    setSavingMarketPortfolio(true);
    try {
      const response = await request<{ ok: boolean; portfolio: MarketPortfolio }>("/admin/api/market/config", {
        method: "PUT",
        body: JSON.stringify({ portfolio: payload })
      });
      applyPortfolioSnapshot(normalizeMarketPortfolio(response.portfolio));
      args.setNotice({ type: "success", title: "Market 持仓配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存 Market 配置失败", text: toMarketErrorText(error) });
    } finally {
      setSavingMarketPortfolio(false);
    }
  }

  async function handleImportMarketCodes(): Promise<void> {
    if (savingMarketPortfolio || savingMarketFundIndex !== null || savingMarketAnalysisConfig || importingMarketCodes) {
      return;
    }
    if (!marketBatchCodesInput.trim()) {
      args.setNotice({ type: "error", title: "请先输入 code 列表" });
      return;
    }

    setImportingMarketCodes(true);
    try {
      const payload = await request<MarketPortfolioImportResponse>("/admin/api/market/portfolio/import-codes", {
        method: "POST",
        body: JSON.stringify({ codes: marketBatchCodesInput.trim() })
      });
      applyPortfolioSnapshot(normalizeMarketPortfolio(payload.portfolio ?? DEFAULT_MARKET_PORTFOLIO));
      const summary = payload.summary ?? { added: 0, updated: 0, exists: 0, not_found: 0, error: 0 };
      const issueCodes = (payload.results ?? [])
        .filter((item) => item.status === "not_found" || item.status === "error")
        .map((item) => item.code)
        .filter(Boolean)
        .slice(0, 8);
      const summaryText = [`新增 ${summary.added}`, `更新 ${summary.updated}`, `已存在 ${summary.exists}`, `未命中 ${summary.not_found}`, `失败 ${summary.error}`].join("，");
      args.setNotice({
        type: summary.error > 0 ? "error" : "success",
        title: "批量导入持仓完成",
        text: issueCodes.length > 0 ? `${summaryText}。异常 code: ${issueCodes.join(", ")}` : summaryText
      });
    } catch (error) {
      args.setNotice({ type: "error", title: "批量导入 market code 失败", text: toMarketErrorText(error) });
    } finally {
      setImportingMarketCodes(false);
    }
  }

  async function handleSaveMarketAnalysisConfig(): Promise<void> {
    if (savingMarketPortfolio || savingMarketFundIndex !== null) {
      return;
    }
    if (!Number.isFinite(Number(marketAnalysisConfig.gptPlugin.timeoutMs)) || Number(marketAnalysisConfig.gptPlugin.timeoutMs) <= 0) {
      args.setNotice({ type: "error", title: "GPT Plugin 超时必须为正整数毫秒" });
      return;
    }
    if (!Number.isFinite(Number(marketAnalysisConfig.fund.maxAgeDays)) || Number(marketAnalysisConfig.fund.maxAgeDays) <= 0) {
      args.setNotice({ type: "error", title: "基金数据最大时效必须为正整数" });
      return;
    }
    if (!Number.isFinite(Number(marketAnalysisConfig.fund.featureLookbackDays)) || Number(marketAnalysisConfig.fund.featureLookbackDays) < 20) {
      args.setNotice({ type: "error", title: "基金特征回看天数至少 20 天" });
      return;
    }
    if (!Number.isFinite(Number(marketAnalysisConfig.fund.llmRetryMax)) || Number(marketAnalysisConfig.fund.llmRetryMax) <= 0) {
      args.setNotice({ type: "error", title: "基金 LLM 重试次数必须为正整数" });
      return;
    }

    const normalizedConfigRaw = normalizeMarketAnalysisConfig(marketAnalysisConfig);
    const normalizedConfig = {
      ...normalizedConfigRaw,
      analysisEngine: resolveMarketAnalysisProviderId(normalizedConfigRaw.analysisEngine, args.llmProviderStore),
      searchEngine: resolveMarketSearchEngineId(normalizedConfigRaw.searchEngine, args.marketSearchEngineStore)
    };

    setSavingMarketAnalysisConfig(true);
    try {
      const response = await request<{ ok: boolean; portfolio: MarketPortfolio; config: MarketAnalysisConfig }>(
        "/admin/api/market/config",
        {
          method: "PUT",
          body: JSON.stringify({ config: normalizedConfig })
        }
      );
      const nextConfigRaw = normalizeMarketAnalysisConfig(response.config);
      setMarketAnalysisConfig({
        ...nextConfigRaw,
        analysisEngine: resolveMarketAnalysisProviderId(nextConfigRaw.analysisEngine, args.llmProviderStore),
        searchEngine: resolveMarketSearchEngineId(nextConfigRaw.searchEngine, args.marketSearchEngineStore)
      });
      args.setNotice({ type: "success", title: "Market 分析引擎配置已保存" });
    } catch (error) {
      args.setNotice({ type: "error", title: "保存 Market 分析引擎配置失败", text: toMarketErrorText(error) });
    } finally {
      setSavingMarketAnalysisConfig(false);
    }
  }

  return {
    marketConfig,
    marketPortfolio,
    marketAnalysisConfig,
    savingMarketPortfolio,
    savingMarketAnalysisConfig,
    marketFundSaveStates,
    marketBatchCodesInput,
    importingMarketCodes,
    marketSearchInputs,
    marketSearchResults,
    searchingMarketFundIndex,
    setMarketAnalysisConfig,
    setMarketBatchCodesInput,
    loadMarketConfig,
    handleAddMarketFund,
    handleRemoveMarketFund,
    handleMarketCashChange,
    handleMarketAnalysisEngineChange,
    handleMarketSearchEngineChange,
    handleMarketGptPluginTimeoutMsChange,
    handleMarketGptPluginFallbackToLocalChange,
    handleMarketFundEnabledChange,
    handleMarketFundMaxAgeDaysChange,
    handleMarketFundFeatureLookbackDaysChange,
    handleMarketFundRiskLevelChange,
    handleMarketFundLlmRetryMaxChange,
    handleMarketFundNewsQuerySuffixChange,
    handleMarketFundChange,
    handleMarketSearchInputChange,
    handleSearchMarketByName,
    handleApplyMarketSearchResult,
    handleSaveMarketFund,
    handleSaveMarketPortfolio,
    handleImportMarketCodes,
    handleSaveMarketAnalysisConfig
  };
}
