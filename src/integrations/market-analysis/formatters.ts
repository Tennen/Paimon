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
    lines.push(`- ${item.code} | quantity=${formatNumber(item.quantity)} | avgCost=${formatNumber(item.avgCost)}`);
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
    `数量: ${formatNumber(holding.quantity)}`,
    `平均成本: ${formatNumber(holding.avgCost)}`,
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
    if (signalResult.fund_dashboards.length === 0) {
      lines.push("基金决策: 无可用标的");
    } else {
      lines.push("基金决策:");
      for (const dashboard of signalResult.fund_dashboards.slice(0, 24)) {
        const code = String(dashboard.fund_code || "").trim();
        const name = String(dashboard.fund_name || "").trim();
        const label = name && code ? `${name}(${code})` : (name || code || "-");
        const decision = String(dashboard.decision_type || "watch").trim();
        const confidence = Number.isFinite(Number(dashboard.confidence))
          ? Number(dashboard.confidence).toFixed(2)
          : "0.00";
        const conclusion = dashboard.core_conclusion && dashboard.core_conclusion.one_sentence
          ? String(dashboard.core_conclusion.one_sentence).trim()
          : "未提供";
        lines.push(`- ${label}: ${decision} (confidence=${confidence})`);
        lines.push(`  结论: ${conclusion}`);
        const risks = Array.isArray(dashboard.risk_alerts) ? dashboard.risk_alerts.slice(0, 3) : [];
        if (risks.length > 0) {
          lines.push(`  风险: ${risks.join(" | ")}`);
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
    "/market fund <midday|close>    运行基金分析主流程（标准化->特征->规则->LLM->JSON）",
    "/market equity <midday|close>  运行原股票信号流程",
    "/market midday         运行 13:30 盘中分析",
    "/market close          运行 15:15 收盘分析",
    "/market status         查看最近一次运行结果",
    "/market portfolio      查看当前持仓配置",
    "/market add <code> <quantity> <avgCost> [name]    添加/加仓持仓（同 code 自动加权成本）",
    "",
    "配置存储键:",
    `- 持仓: ${MARKET_PORTFOLIO_STORE}`,
    `- 分析配置: ${MARKET_CONFIG_STORE}`,
    `- 状态: ${MARKET_STATE_STORE}`,
    `- 快照明细: ${MARKET_RUNS_STORE}`
  ].join("\n");
}
