import { DEFAULT_MARKET_ANALYSIS_CONFIG, DEFAULT_MARKET_PORTFOLIO } from "@/types/admin";
import type {
  MarketAnalysisConfig,
  MarketAnalysisEngine,
  MarketConfig,
  MarketFundHolding,
  MarketFundRiskLevel,
  MarketPortfolio,
  MarketPortfolioImportResponse,
  MarketSecuritySearchItem
} from "@/types/admin";
import { request } from "../adminApi";
import {
  isSameMarketFund,
  isValidMarketFund,
  normalizeMarketAnalysisConfig,
  normalizeMarketFund,
  normalizeMarketPortfolio,
  resolveMarketAnalysisProviderId,
  resolveMarketSearchEngineId,
  resizeSavedFundsArray,
  resizeSearchResultsArray,
  resizeStringArray,
  toMarketErrorText
} from "../marketAdminUtils";
import type { AdminMarketPortfolioSlice } from "./slices";
import type { AdminSliceCreator } from "./types";

function computeMarketFundSaveStates(
  funds: MarketFundHolding[],
  savedByRow: Array<MarketFundHolding | null>,
  savingIndex: number | null
): Array<"saved" | "dirty" | "saving"> {
  return funds.map((fund, index) => {
    if (savingIndex === index) {
      return "saving";
    }
    const saved = savedByRow[index];
    if (!saved) {
      return "dirty";
    }
    return isSameMarketFund(normalizeMarketFund(saved), normalizeMarketFund(fund)) ? "saved" : "dirty";
  });
}

export const createMarketPortfolioSlice: AdminSliceCreator<AdminMarketPortfolioSlice> = (set, get) => {
  const applyPortfolioSnapshot = (portfolio: MarketPortfolio): void => {
    const savedByRow = portfolio.funds.map((fund) => ({ ...fund }));
    set((state) => ({
      marketPortfolio: portfolio,
      marketSavedFundsByRow: savedByRow,
      marketSavedCash: portfolio.cash,
      marketSearchInputs: resizeStringArray(state.marketSearchInputs, portfolio.funds.length),
      marketSearchResults: resizeSearchResultsArray(state.marketSearchResults, portfolio.funds.length),
      marketFundSaveStates: computeMarketFundSaveStates(portfolio.funds, savedByRow, state.savingMarketFundIndex)
    }));
  };

  return {
    marketConfig: null,
    marketPortfolio: DEFAULT_MARKET_PORTFOLIO,
    marketAnalysisConfig: DEFAULT_MARKET_ANALYSIS_CONFIG,
    savingMarketPortfolio: false,
    savingMarketAnalysisConfig: false,
    savingMarketFundIndex: null,
    marketFundSaveStates: [],
    marketSavedFundsByRow: [],
    marketSavedCash: 0,
    marketBatchCodesInput: "",
    importingMarketCodes: false,
    marketSearchInputs: [],
    marketSearchResults: [],
    searchingMarketFundIndex: null,
    syncMarketAnalysisBindings: () => {
      set((state) => {
        const nextAnalysisEngine = resolveMarketAnalysisProviderId(state.marketAnalysisConfig.analysisEngine, state.llmProviderStore);
        const nextSearchEngine = resolveMarketSearchEngineId(state.marketAnalysisConfig.searchEngine, state.marketSearchEngineStore);
        if (
          nextAnalysisEngine === state.marketAnalysisConfig.analysisEngine
          && nextSearchEngine === state.marketAnalysisConfig.searchEngine
        ) {
          return {};
        }
        return {
          marketAnalysisConfig: {
            ...state.marketAnalysisConfig,
            analysisEngine: nextAnalysisEngine,
            searchEngine: nextSearchEngine
          }
        };
      });
    },
    setMarketBatchCodesInput: (value) => {
      set({ marketBatchCodesInput: value });
    },
    loadMarketConfig: async () => {
      const payload = await request<MarketConfig>("/admin/api/market/config");
      const portfolio = normalizeMarketPortfolio(payload.portfolio ?? DEFAULT_MARKET_PORTFOLIO);
      const analysisConfigRaw = normalizeMarketAnalysisConfig(payload.config ?? DEFAULT_MARKET_ANALYSIS_CONFIG);

      set({
        marketConfig: payload,
        marketAnalysisConfig: {
          ...analysisConfigRaw,
          analysisEngine: resolveMarketAnalysisProviderId(analysisConfigRaw.analysisEngine, get().llmProviderStore),
          searchEngine: resolveMarketSearchEngineId(analysisConfigRaw.searchEngine, get().marketSearchEngineStore)
        }
      });
      applyPortfolioSnapshot(portfolio);
    },
    handleAddMarketFund: () => {
      set((state) => {
        const nextFunds = state.marketPortfolio.funds.concat([{ code: "", name: "" }]);
        const nextSavedFundsByRow = state.marketSavedFundsByRow.concat(null);
        return {
          marketPortfolio: {
            ...state.marketPortfolio,
            funds: nextFunds
          },
          marketSavedFundsByRow: nextSavedFundsByRow,
          marketSearchInputs: resizeStringArray(state.marketSearchInputs.concat(""), nextFunds.length),
          marketSearchResults: resizeSearchResultsArray(state.marketSearchResults.concat([[]]), nextFunds.length),
          marketFundSaveStates: computeMarketFundSaveStates(nextFunds, nextSavedFundsByRow, state.savingMarketFundIndex)
        };
      });
    },
    handleRemoveMarketFund: (index) => {
      set((state) => {
        const nextFunds = state.marketPortfolio.funds.filter((_, rowIndex) => rowIndex !== index);
        const nextSavedFundsByRow = state.marketSavedFundsByRow.filter((_, rowIndex) => rowIndex !== index);
        const nextSearchingIndex = state.searchingMarketFundIndex === null || state.searchingMarketFundIndex === index
          ? null
          : state.searchingMarketFundIndex > index
            ? state.searchingMarketFundIndex - 1
            : state.searchingMarketFundIndex;
        const nextSavingIndex = state.savingMarketFundIndex === null || state.savingMarketFundIndex === index
          ? null
          : state.savingMarketFundIndex > index
            ? state.savingMarketFundIndex - 1
            : state.savingMarketFundIndex;
        return {
          marketPortfolio: {
            ...state.marketPortfolio,
            funds: nextFunds
          },
          marketSavedFundsByRow: nextSavedFundsByRow,
          marketSearchInputs: resizeStringArray(
            state.marketSearchInputs.filter((_, rowIndex) => rowIndex !== index),
            nextFunds.length
          ),
          marketSearchResults: resizeSearchResultsArray(
            state.marketSearchResults.filter((_, rowIndex) => rowIndex !== index),
            nextFunds.length
          ),
          searchingMarketFundIndex: nextSearchingIndex,
          savingMarketFundIndex: nextSavingIndex,
          marketFundSaveStates: computeMarketFundSaveStates(nextFunds, nextSavedFundsByRow, nextSavingIndex)
        };
      });
    },
    handleMarketCashChange: (value) => {
      set((state) => ({
        marketPortfolio: {
          ...state.marketPortfolio,
          cash: Number.isFinite(value) ? value : 0
        }
      }));
    },
    handleMarketAnalysisEngineChange: (value: MarketAnalysisEngine) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          analysisEngine: value
        }
      }));
    },
    handleMarketSearchEngineChange: (value: string) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          searchEngine: value
        }
      }));
    },
    handleMarketFundNewsQuerySuffixChange: (value) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          fund: {
            ...state.marketAnalysisConfig.fund,
            newsQuerySuffix: String(value || "")
          }
        }
      }));
    },
    handleMarketGptPluginTimeoutMsChange: (value) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          gptPlugin: {
            ...state.marketAnalysisConfig.gptPlugin,
            timeoutMs: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
          }
        }
      }));
    },
    handleMarketGptPluginFallbackToLocalChange: (value) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          gptPlugin: {
            ...state.marketAnalysisConfig.gptPlugin,
            fallbackToLocal: value
          }
        }
      }));
    },
    handleMarketFundEnabledChange: (value) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          fund: {
            ...state.marketAnalysisConfig.fund,
            enabled: value
          }
        }
      }));
    },
    handleMarketFundMaxAgeDaysChange: (value) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          fund: {
            ...state.marketAnalysisConfig.fund,
            maxAgeDays: Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
          }
        }
      }));
    },
    handleMarketFundFeatureLookbackDaysChange: (value) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          fund: {
            ...state.marketAnalysisConfig.fund,
            featureLookbackDays: Number.isFinite(value) ? Math.max(20, Math.floor(value)) : 20
          }
        }
      }));
    },
    handleMarketFundRiskLevelChange: (value: MarketFundRiskLevel) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          fund: {
            ...state.marketAnalysisConfig.fund,
            ruleRiskLevel: value
          }
        }
      }));
    },
    handleMarketFundLlmRetryMaxChange: (value) => {
      set((state) => ({
        marketAnalysisConfig: {
          ...state.marketAnalysisConfig,
          fund: {
            ...state.marketAnalysisConfig.fund,
            llmRetryMax: Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
          }
        }
      }));
    },
    handleMarketFundChange: (index, key, value) => {
      set((state) => {
        const nextFunds = state.marketPortfolio.funds.map((fund, rowIndex) => {
          if (rowIndex !== index) {
            return fund;
          }
          if (key === "code" || key === "name") {
            return { ...fund, [key]: value };
          }
          const trimmed = value.trim();
          const numeric = Number(trimmed);
          if (!trimmed) {
            return {
              ...fund,
              ...(key === "quantity" ? { quantity: undefined } : { avgCost: undefined })
            };
          }
          return key === "quantity"
            ? { ...fund, quantity: Number.isFinite(numeric) && numeric > 0 ? numeric : undefined }
            : { ...fund, avgCost: Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined };
        });
        return {
          marketPortfolio: {
            ...state.marketPortfolio,
            funds: nextFunds
          },
          marketFundSaveStates: computeMarketFundSaveStates(nextFunds, state.marketSavedFundsByRow, state.savingMarketFundIndex)
        };
      });
    },
    handleMarketSearchInputChange: (index, value) => {
      set((state) => {
        const next = resizeStringArray(state.marketSearchInputs, state.marketPortfolio.funds.length).slice();
        if (index >= 0 && index < next.length) {
          next[index] = value;
        }
        return {
          marketSearchInputs: next
        };
      });
    },
    handleSearchMarketByName: async (index) => {
      const keyword = (get().marketSearchInputs[index] ?? "").trim();
      if (!keyword) {
        get().setNotice({ type: "error", title: "请输入名称后再查找" });
        return;
      }

      set({ searchingMarketFundIndex: index });
      try {
        const payload = await request<{ keyword: string; items: MarketSecuritySearchItem[] }>(
          `/admin/api/market/securities/search?keyword=${encodeURIComponent(keyword)}&limit=8`
        );
        const items = Array.isArray(payload.items) ? payload.items : [];
        set((state) => {
          const next = resizeSearchResultsArray(state.marketSearchResults, state.marketPortfolio.funds.length).slice();
          if (index >= 0 && index < next.length) {
            next[index] = items;
          }
          return {
            marketSearchResults: next
          };
        });
        if (items.length === 0) {
          get().setNotice({ type: "info", title: `未找到“${keyword}”相关代码` });
        }
      } catch (error) {
        get().setNotice({ type: "error", title: "名称查找 code 失败", text: toMarketErrorText(error) });
      } finally {
        set((state) => ({
          searchingMarketFundIndex: state.searchingMarketFundIndex === index ? null : state.searchingMarketFundIndex
        }));
      }
    },
    handleApplyMarketSearchResult: (index, item) => {
      set((state) => {
        const nextFunds = state.marketPortfolio.funds.map((fund, rowIndex) => (
          rowIndex === index ? { ...fund, code: item.code, name: item.name } : fund
        ));
        const nextInputs = resizeStringArray(state.marketSearchInputs, state.marketPortfolio.funds.length).slice();
        if (index >= 0 && index < nextInputs.length) {
          nextInputs[index] = item.name;
        }
        const nextResults = resizeSearchResultsArray(state.marketSearchResults, state.marketPortfolio.funds.length).slice();
        if (index >= 0 && index < nextResults.length) {
          nextResults[index] = [];
        }
        return {
          marketPortfolio: {
            ...state.marketPortfolio,
            funds: nextFunds
          },
          marketSearchInputs: nextInputs,
          marketSearchResults: nextResults,
          marketFundSaveStates: computeMarketFundSaveStates(nextFunds, state.marketSavedFundsByRow, state.savingMarketFundIndex)
        };
      });
    },
    handleSaveMarketFund: async (index) => {
      if (get().savingMarketPortfolio || get().savingMarketFundIndex !== null) {
        return;
      }
      const fund = get().marketPortfolio.funds[index];
      const target = fund ? normalizeMarketFund(fund) : null;
      if (!target || !isValidMarketFund(target)) {
        get().setNotice({ type: "error", title: "请先填写合法代码后再保存该行" });
        return;
      }

      const funds = get().marketPortfolio.funds
        .map((_, rowIndex) => (rowIndex === index ? target : get().marketSavedFundsByRow[rowIndex]))
        .filter((item): item is MarketFundHolding => item !== null && isValidMarketFund(item))
        .map((item) => normalizeMarketFund(item));

      set((state) => ({
        savingMarketFundIndex: index,
        marketFundSaveStates: computeMarketFundSaveStates(state.marketPortfolio.funds, state.marketSavedFundsByRow, index)
      }));
      try {
        const response = await request<{ ok: boolean; portfolio: MarketPortfolio }>("/admin/api/market/config", {
          method: "PUT",
          body: JSON.stringify({ portfolio: { funds, cash: get().marketSavedCash } })
        });
        const nextPortfolio = normalizeMarketPortfolio(response.portfolio);
        set((state) => {
          const nextFunds = state.marketPortfolio.funds.map((item, rowIndex) => (rowIndex === index ? target : item));
          const nextSavedByRow = resizeSavedFundsArray(state.marketSavedFundsByRow, state.marketPortfolio.funds.length).slice();
          if (index >= 0 && index < nextSavedByRow.length) {
            nextSavedByRow[index] = { ...target };
          }
          return {
            marketPortfolio: {
              ...state.marketPortfolio,
              funds: nextFunds
            },
            marketSavedFundsByRow: nextSavedByRow,
            marketSavedCash: nextPortfolio.cash,
            marketFundSaveStates: computeMarketFundSaveStates(nextFunds, nextSavedByRow, state.savingMarketFundIndex)
          };
        });
        get().setNotice({ type: "success", title: "该行持仓已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存该行持仓失败", text: toMarketErrorText(error) });
      } finally {
        set((state) => ({
          savingMarketFundIndex: state.savingMarketFundIndex === index ? null : state.savingMarketFundIndex,
          marketFundSaveStates: computeMarketFundSaveStates(
            state.marketPortfolio.funds,
            state.marketSavedFundsByRow,
            state.savingMarketFundIndex === index ? null : state.savingMarketFundIndex
          )
        }));
      }
    },
    handleSaveMarketPortfolio: async () => {
      if (get().savingMarketFundIndex !== null || get().savingMarketAnalysisConfig) {
        return;
      }

      const payload: MarketPortfolio = {
        funds: get().marketPortfolio.funds.map((fund) => normalizeMarketFund(fund)).filter((fund) => isValidMarketFund(fund)),
        cash: Number.isFinite(Number(get().marketPortfolio.cash)) && Number(get().marketPortfolio.cash) > 0
          ? Number(get().marketPortfolio.cash)
          : 0
      };

      set({ savingMarketPortfolio: true });
      try {
        const response = await request<{ ok: boolean; portfolio: MarketPortfolio }>("/admin/api/market/config", {
          method: "PUT",
          body: JSON.stringify({ portfolio: payload })
        });
        applyPortfolioSnapshot(normalizeMarketPortfolio(response.portfolio));
        get().setNotice({ type: "success", title: "Market 持仓配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存 Market 配置失败", text: toMarketErrorText(error) });
      } finally {
        set({ savingMarketPortfolio: false });
      }
    },
    handleSaveMarketAnalysisConfig: async () => {
      if (get().savingMarketPortfolio || get().savingMarketFundIndex !== null) {
        return;
      }
      if (!Number.isFinite(Number(get().marketAnalysisConfig.gptPlugin.timeoutMs)) || Number(get().marketAnalysisConfig.gptPlugin.timeoutMs) <= 0) {
        get().setNotice({ type: "error", title: "GPT Plugin 超时必须为正整数毫秒" });
        return;
      }
      if (!Number.isFinite(Number(get().marketAnalysisConfig.fund.maxAgeDays)) || Number(get().marketAnalysisConfig.fund.maxAgeDays) <= 0) {
        get().setNotice({ type: "error", title: "基金数据最大时效必须为正整数" });
        return;
      }
      if (
        !Number.isFinite(Number(get().marketAnalysisConfig.fund.featureLookbackDays))
        || Number(get().marketAnalysisConfig.fund.featureLookbackDays) < 20
      ) {
        get().setNotice({ type: "error", title: "基金特征回看天数至少 20 天" });
        return;
      }
      if (!Number.isFinite(Number(get().marketAnalysisConfig.fund.llmRetryMax)) || Number(get().marketAnalysisConfig.fund.llmRetryMax) <= 0) {
        get().setNotice({ type: "error", title: "基金 LLM 重试次数必须为正整数" });
        return;
      }

      const normalizedConfigRaw = normalizeMarketAnalysisConfig(get().marketAnalysisConfig);
      const normalizedConfig = {
        ...normalizedConfigRaw,
        analysisEngine: resolveMarketAnalysisProviderId(normalizedConfigRaw.analysisEngine, get().llmProviderStore),
        searchEngine: resolveMarketSearchEngineId(normalizedConfigRaw.searchEngine, get().marketSearchEngineStore)
      };

      set({ savingMarketAnalysisConfig: true });
      try {
        const response = await request<{ ok: boolean; portfolio: MarketPortfolio; config: MarketAnalysisConfig }>(
          "/admin/api/market/config",
          {
            method: "PUT",
            body: JSON.stringify({ config: normalizedConfig })
          }
        );
        const nextConfigRaw = normalizeMarketAnalysisConfig(response.config);
        set({
          marketAnalysisConfig: {
            ...nextConfigRaw,
            analysisEngine: resolveMarketAnalysisProviderId(nextConfigRaw.analysisEngine, get().llmProviderStore),
            searchEngine: resolveMarketSearchEngineId(nextConfigRaw.searchEngine, get().marketSearchEngineStore)
          }
        });
        get().setNotice({ type: "success", title: "Market 分析引擎配置已保存" });
      } catch (error) {
        get().setNotice({ type: "error", title: "保存 Market 分析引擎配置失败", text: toMarketErrorText(error) });
      } finally {
        set({ savingMarketAnalysisConfig: false });
      }
    },
    handleImportMarketCodes: async () => {
      if (get().savingMarketPortfolio || get().savingMarketFundIndex !== null || get().savingMarketAnalysisConfig || get().importingMarketCodes) {
        return;
      }
      if (!get().marketBatchCodesInput.trim()) {
        get().setNotice({ type: "error", title: "请先输入 code 列表" });
        return;
      }

      set({ importingMarketCodes: true });
      try {
        const payload = await request<MarketPortfolioImportResponse>("/admin/api/market/portfolio/import-codes", {
          method: "POST",
          body: JSON.stringify({ codes: get().marketBatchCodesInput.trim() })
        });
        applyPortfolioSnapshot(normalizeMarketPortfolio(payload.portfolio ?? DEFAULT_MARKET_PORTFOLIO));
        const summary = payload.summary ?? { added: 0, updated: 0, exists: 0, not_found: 0, error: 0 };
        const issueCodes = (payload.results ?? [])
          .filter((item) => item.status === "not_found" || item.status === "error")
          .map((item) => item.code)
          .filter(Boolean)
          .slice(0, 8);
        const summaryText = [
          `新增 ${summary.added}`,
          `更新 ${summary.updated}`,
          `已存在 ${summary.exists}`,
          `未命中 ${summary.not_found}`,
          `失败 ${summary.error}`
        ].join("，");
        get().setNotice({
          type: summary.error > 0 ? "error" : "success",
          title: "批量导入持仓完成",
          text: issueCodes.length > 0 ? `${summaryText}。异常 code: ${issueCodes.join(", ")}` : summaryText
        });
      } catch (error) {
        get().setNotice({ type: "error", title: "批量导入 market code 失败", text: toMarketErrorText(error) });
      } finally {
        set({ importingMarketCodes: false });
      }
    }
  };
};
