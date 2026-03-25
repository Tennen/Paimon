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
    `相对参照: ${latest.comparisonReference || "-"}`,
    `资产信号数: ${latest.assetSignalCount || 0}`
  ];

  if (latest.explanationSummary) {
    lines.push(`解释: ${latest.explanationSummary}`);
  }

  return lines.join("\n");
}

export function buildHelpText() {
  return [
    "Market Analysis 命令:",
    "/market [fund] <midday|close>  运行基金分析主流程并生成 markdown 图片报告",
    "/market midday         运行 13:30 盘中图片报告",
    "/market close          运行 15:15 收盘图片报告",
    "/market status         查看最近一次运行结果",
    "/market portfolio      查看当前持仓配置",
    "/market add <code> <quantity> <avgCost> [name]    添加/加仓持仓（同 code 自动加权成本）",
    "",
    "说明:",
    "- 分析命令仅支持 markdown 图片报告链路，要求 analysisEngine 实际 provider=codex。",
    "",
    "配置存储键:",
    `- 持仓: ${MARKET_PORTFOLIO_STORE}`,
    `- 分析配置: ${MARKET_CONFIG_STORE}`,
    `- 状态: ${MARKET_STATE_STORE}`,
    `- 快照明细: ${MARKET_RUNS_STORE}`
  ].join("\n");
}
