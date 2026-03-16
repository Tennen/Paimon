// @ts-nocheck
import {
  MARKET_CONFIG_STORE,
  MARKET_PORTFOLIO_STORE,
  MARKET_RUNS_STORE,
  MARKET_STATE_STORE
} from "./defaults";
import { formatNumber, phaseLabel } from "./utils";

export function formatPortfolio(portfolio) {
  const lines = [
    "Market Analysis 持仓配置",
    `现金: ${formatNumber(portfolio.cash)}`
  ];

  if (portfolio.funds.length === 0) {
    lines.push("持仓: (空)");
    lines.push(`持仓存储键: ${MARKET_PORTFOLIO_STORE}`);
    return lines.join("\n");
  }

  lines.push("持仓:");
  for (const item of portfolio.funds) {
    const metrics = [];
    if (Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0) {
      metrics.push(`quantity=${formatNumber(item.quantity)}`);
    }
    if (Number.isFinite(Number(item.avgCost)) && Number(item.avgCost) >= 0) {
      metrics.push(`avgCost=${formatNumber(item.avgCost)}`);
    }
    lines.push(`- ${item.code}${metrics.length > 0 ? ` | ${metrics.join(" | ")}` : ""}`);
  }
  lines.push(`持仓存储键: ${MARKET_PORTFOLIO_STORE}`);

  return lines.join("\n");
}

export function formatPortfolioAddResult(result) {
  const holding = result && result.holding ? result.holding : {};
  const actionText = result && result.action === "updated" ? "持仓已更新。" : "持仓已新增。";
  const holdingLabel = holding.name ? `${holding.code} (${holding.name})` : `${holding.code || "-"}`;

  return [
    actionText,
    `标的: ${holdingLabel}`,
    `数量: ${Number.isFinite(Number(holding.quantity)) && Number(holding.quantity) > 0 ? formatNumber(holding.quantity) : "-"}`,
    `平均成本: ${Number.isFinite(Number(holding.avgCost)) && Number(holding.avgCost) >= 0 ? formatNumber(holding.avgCost) : "-"}`,
    "",
    formatPortfolio(result.portfolio || { funds: [], cash: 0 })
  ].join("\n");
}

export function formatStatus(state) {
  const recent = Array.isArray(state.recentRuns) ? state.recentRuns : [];
  if (recent.length === 0) {
    return [
      "尚无 Market Analysis 运行记录。",
      `运行状态存储键: ${MARKET_STATE_STORE}`
    ].join("\n");
  }

  const latest = recent[0];
  const lines = [
    "Market Analysis 最近状态",
    `最近运行: ${latest.createdAt || "-"}`,
    `阶段: ${phaseLabel(latest.phase)}`,
    `市场状态: ${latest.marketState || "-"}`,
    `基准指数: ${latest.benchmark || "-"}`,
    `资产信号数: ${latest.assetSignalCount || 0}`
  ];

  if (latest.explanationSummary) {
    lines.push(`解释: ${latest.explanationSummary}`);
  }

  return lines.join("\n");
}

export function buildRunResponseText(result) {
  const signalResult = result.signalResult;
  const assetType = signalResult && signalResult.assetType ? signalResult.assetType : "equity";
  const lines = [
    `Market Analysis ${phaseLabel(signalResult.phase)} 完成`,
    `资产类型: ${assetType}`,
    `市场状态: ${signalResult.marketState}${signalResult.benchmark ? ` (${signalResult.benchmark})` : ""}`
  ];

  if (assetType === "fund" && Array.isArray(signalResult.fund_dashboards)) {
    const fundRecords = Array.isArray(result.marketData && result.marketData.funds)
      ? result.marketData.funds
      : [];
    const fundRecordMap = new Map();
    for (const record of fundRecords) {
      const code = String(record && record.identity && record.identity.fund_code || "").trim();
      if (!code) {
        continue;
      }
      fundRecordMap.set(code, record);
    }

    if (signalResult.fund_dashboards.length === 0) {
      lines.push("基金决策: 无可用标的");
    } else {
      lines.push("基金决策:");
      for (const dashboard of signalResult.fund_dashboards.slice(0, 24)) {
        const code = String(dashboard.fund_code || "").trim();
        const name = String(dashboard.fund_name || "").trim();
        const label = name && code ? `${name}(${code})` : (name || code || "-");
        const decision = String(dashboard.decision_type || "watch").trim();
        const score = Number.isFinite(Number(dashboard.sentiment_score))
          ? Math.round(Number(dashboard.sentiment_score))
          : 0;
        const confidence = Number.isFinite(Number(dashboard.confidence))
          ? Number(dashboard.confidence).toFixed(2)
          : "0.00";
        const conclusion = dashboard.core_conclusion && dashboard.core_conclusion.one_sentence
          ? String(dashboard.core_conclusion.one_sentence).trim()
          : "未提供";
        const actionSuggestion = dashboard.action_plan && dashboard.action_plan.suggestion
          ? String(dashboard.action_plan.suggestion).trim()
          : "";
        const positionChange = dashboard.action_plan && dashboard.action_plan.position_change
          ? String(dashboard.action_plan.position_change).trim()
          : "";
        const metricSummary = buildFundMetricSummary(dashboard);
        const record = fundRecordMap.get(code);
        const newsStatus = describeNewsStatus(record && record.raw_context);
        const newsHeadline = pickTopNewsHeadline(record && record.raw_context);

        lines.push(`- ${label}: ${decision} | score=${score} | confidence=${confidence}`);
        lines.push(`  结论: ${conclusion}`);
        if (actionSuggestion || positionChange) {
          lines.push(`  执行: ${actionSuggestion || "未提供"}${positionChange ? ` | 仓位: ${positionChange}` : ""}`);
        }
        if (metricSummary.length > 0) {
          lines.push(`  关键指标: ${metricSummary.join(" | ")}`);
        }
        const risks = Array.isArray(dashboard.risk_alerts) ? dashboard.risk_alerts.slice(0, 3) : [];
        if (risks.length > 0) {
          lines.push(`  风险: ${risks.join(" | ")}`);
        }
        if (dashboard.insufficient_data && dashboard.insufficient_data.is_insufficient) {
          const missing = Array.isArray(dashboard.insufficient_data.missing_fields)
            ? dashboard.insufficient_data.missing_fields.slice(0, 4).join(", ")
            : "";
          lines.push(`  数据完整性: 不足${missing ? ` (missing=${missing})` : ""}`);
        }
        lines.push(`  新闻检索: ${newsStatus}`);
        if (newsHeadline) {
          lines.push(`  新闻样本: ${newsHeadline}`);
        }
      }
    }

    if (signalResult.portfolio_report && signalResult.portfolio_report.brief) {
      lines.push(`组合摘要: ${signalResult.portfolio_report.brief}`);
    }

    if (result.explanation && result.explanation.error) {
      lines.push(`解释生成失败: ${result.explanation.error}`);
    }

    return lines.join("\n");
  }

  if (Array.isArray(signalResult.assetSignals) && signalResult.assetSignals.length > 0) {
    lines.push("资产信号:");
    for (const signal of signalResult.assetSignals) {
      lines.push(`- ${signal.code}: ${signal.signal}`);
    }
  } else {
    lines.push("资产信号: 无持仓或无可用资产数据");
  }

  if (result.explanation && result.explanation.summary) {
    lines.push(`解释: ${result.explanation.summary}`);
  }

  if (result.explanation && Array.isArray(result.explanation.holdings) && result.explanation.holdings.length > 0) {
    lines.push("持仓逐项建议:");
    for (const holding of result.explanation.holdings.slice(0, 24)) {
      const code = String(holding.code || "").trim();
      const name = String(holding.name || "").trim();
      const label = name && code ? `${name}(${code})` : (name || code || "-");
      const inputData = String(holding.inputData || "").trim();
      const shortTermAdvice = String(holding.shortTermAdvice || "").trim();
      const longTermAdvice = String(holding.longTermAdvice || "").trim();
      lines.push(`- ${label}`);
      lines.push(`  关键数据: ${inputData || "数据缺失"}`);
      lines.push(`  短期(1-5日): ${shortTermAdvice || "未提供"}`);
      lines.push(`  长期(1-3月): ${longTermAdvice || "未提供"}`);
    }
  }

  if (result.explanation && Array.isArray(result.explanation.suggestions) && result.explanation.suggestions.length > 0) {
    lines.push("参考建议(可不采纳，不改变既有信号):");
    for (const suggestion of result.explanation.suggestions.slice(0, 3)) {
      lines.push(`- ${suggestion}`);
    }
  }

  if (result.explanation && result.explanation.error) {
    lines.push(`解释生成失败: ${result.explanation.error}`);
  }

  return lines.join("\n");
}

export function buildHelpText() {
  return [
    "Market Analysis 命令:",
    "/market fund <midday|close>    运行基金分析主流程（标准化->特征->规则->LLM）",
    "/market equity <midday|close>  运行原股票信号流程",
    "/market midday         运行 13:30 盘中分析",
    "/market close          运行 15:15 收盘分析",
    "/market status         查看最近一次运行结果",
    "/market portfolio      查看当前持仓配置",
    "/market add <code> <quantity> <avgCost> [name]    添加/加仓持仓（同 code 自动加权成本）",
    "",
    "说明:",
    "- 当 analysisEngine 实际 provider=codex 且启用解释时，会切换为“单次 markdown 报告”模式，并尝试生成长图推送。",
    "",
    "配置存储键:",
    `- 持仓: ${MARKET_PORTFOLIO_STORE}`,
    `- 分析配置: ${MARKET_CONFIG_STORE}`,
    `- 状态: ${MARKET_STATE_STORE}`,
    `- 快照明细: ${MARKET_RUNS_STORE}`
  ].join("\n");
}

function buildFundMetricSummary(dashboard) {
  const metrics = [];
  const returns = dashboard && dashboard.data_perspective && dashboard.data_perspective.return_metrics
    ? dashboard.data_perspective.return_metrics
    : {};
  const risks = dashboard && dashboard.data_perspective && dashboard.data_perspective.risk_metrics
    ? dashboard.data_perspective.risk_metrics
    : {};
  const relative = dashboard && dashboard.data_perspective && dashboard.data_perspective.relative_metrics
    ? dashboard.data_perspective.relative_metrics
    : {};
  const coverage = dashboard && dashboard.data_perspective
    ? String(dashboard.data_perspective.feature_coverage || "").trim()
    : "";

  if (coverage) {
    metrics.push(`coverage=${coverage}`);
  }

  const ret20d = formatMetricValue(returns.ret_20d, 2, "%", true);
  if (ret20d) {
    metrics.push(`ret20d=${ret20d}`);
  }
  const ret60d = formatMetricValue(returns.ret_60d, 2, "%", true);
  if (ret60d) {
    metrics.push(`ret60d=${ret60d}`);
  }
  const drawdown = formatMetricValue(risks.max_drawdown, 2, "%", true);
  if (drawdown) {
    metrics.push(`maxDD=${drawdown}`);
  }
  const volatility = formatMetricValue(risks.volatility_annualized, 2, "%", false);
  if (volatility) {
    metrics.push(`vol=${volatility}`);
  }
  const excess20d = formatMetricValue(relative.benchmark_excess_20d, 2, "%", true);
  if (excess20d) {
    metrics.push(`excess20d=${excess20d}`);
  }

  return metrics.slice(0, 5);
}

function formatMetricValue(value, digits, suffix, signed) {
  if (value === null || value === undefined || value === "not_supported") {
    return "";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  const normalized = Number(numeric.toFixed(digits));
  const prefix = signed && normalized > 0 ? "+" : "";
  return `${prefix}${normalized}${suffix || ""}`;
}

function describeNewsStatus(rawContext) {
  const sourceChain = Array.isArray(rawContext && rawContext.source_chain) ? rawContext.source_chain : [];
  const errors = Array.isArray(rawContext && rawContext.errors) ? rawContext.errors : [];
  const newsItems = rawContext && rawContext.events && Array.isArray(rawContext.events.market_news)
    ? rawContext.events.market_news
    : [];
  const newsCount = newsItems.length;
  const disabledSearchEngine = sourceChain.find((item) => /search_engine:.+:disabled$/.test(String(item || "")));
  if (disabledSearchEngine) {
    const engineId = String(disabledSearchEngine).replace(/^search_engine:/, "").replace(/:disabled$/, "");
    return `Search Engine 已禁用（${engineId || "unknown"}）`;
  }
  const missingSearchEngine = sourceChain.find((item) => /search_engine:missing:/.test(String(item || "")));
  if (missingSearchEngine) {
    return `Search Engine 缺失（${String(missingSearchEngine).replace(/^search_engine:missing:/, "")}）`;
  }

  if (sourceChain.includes("env:MARKET_ANALYSIS_NEWS_CONTEXT")) {
    return `使用环境变量新闻上下文 (${newsCount}条)`;
  }
  if (sourceChain.includes("serpapi:disabled_no_key")) {
    return "未启用 SerpAPI（SERPAPI_KEY 未配置）";
  }
  const serpApiSource = sourceChain.find((item) => String(item || "").startsWith("serpapi:"));
  if (serpApiSource) {
    const serpApiEngine = String(serpApiSource).replace(/^serpapi:/, "") || "unknown";
    if (newsCount > 0) {
      return `SerpAPI(${serpApiEngine}) 命中 ${newsCount} 条`;
    }
    const serpError = errors.find((item) => /serpapi/i.test(String(item || "")));
    if (serpError) {
      return `SerpAPI 失败: ${serpError}`;
    }
    return `SerpAPI(${serpApiEngine}) 已调用，未命中相关新闻`;
  }
  const fallbackSource = sourceChain.find((item) => String(item).startsWith("fallback:"));
  if (fallbackSource) {
    return newsCount > 0 ? `回退新闻源命中 ${newsCount} 条` : "回退新闻源无结果";
  }
  const serpError = errors.find((item) => /serpapi/i.test(String(item || "")));
  if (serpError) {
    return `SerpAPI 失败: ${serpError}`;
  }
  return newsCount > 0 ? `新闻命中 ${newsCount} 条` : "未获取到相关新闻";
}

function pickTopNewsHeadline(rawContext) {
  const newsItems = rawContext && rawContext.events && Array.isArray(rawContext.events.market_news)
    ? rawContext.events.market_news
    : [];
  if (newsItems.length === 0) {
    return "";
  }
  const item = newsItems[0] || {};
  const title = String(item.title || "").trim();
  const source = String(item.source || "").trim();
  if (!title) {
    return "";
  }
  return source ? `${title} (${source})` : title;
}
