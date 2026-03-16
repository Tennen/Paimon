// @ts-nocheck
import { parseCommand } from "./commands";
import {
  buildHelpText,
  buildRunResponseText,
  formatPortfolio,
  formatPortfolioAddResult,
  formatStatus
} from "./formatters";
import { renderMarkdownAsLongImage } from "../user-message/markdownImageAdapter";
import { runAnalysis } from "./runtime";
import { addPortfolioHolding, ensureStorage, readPortfolio, readState } from "./storage";

export const directCommands = ["/market"];

export async function execute(input) {
  ensureStorage();

  const command = parseCommand(input);

  if (command.kind === "help") {
    return { text: buildHelpText() };
  }

  if (command.kind === "portfolio") {
    const portfolio = readPortfolio();
    return { text: formatPortfolio(portfolio) };
  }

  if (command.kind === "portfolio_add") {
    const result = addPortfolioHolding(command.holding);
    return { text: formatPortfolioAddResult(result) };
  }

  if (command.kind === "status") {
    return { text: formatStatus(readState()) };
  }

  const phase = command.phase;
  const withExplanation = command.withExplanation;
  const assetType = command.assetType;

  const result = await runAnalysis(phase, withExplanation, {
    assetType
  });

  let text = buildRunResponseText(result);
  let image = null;
  const markdownReport = String(result.explanation && result.explanation.markdown || "").trim();
  if (markdownReport) {
    try {
      image = await renderMarkdownAsLongImage({
        markdown: markdownReport,
        title: `Market Analysis ${phase}`,
        filenamePrefix: `market-${phase}`
      });
    } catch (error) {
      const detail = (error && error.message) ? error.message : String(error || "unknown error");
      text = `${text}\n长图生成失败: ${detail}`;
    }
  }

  return {
    text,
    ...(image ? { image } : {}),
    result: {
      runId: result.persisted.id,
      phase: result.signalResult.phase,
      assetType: result.signalResult.assetType || assetType || "equity",
      marketState: result.signalResult.marketState,
      generatedAt: result.signalResult.generatedAt,
      signalResult: result.signalResult,
      explanation: result.explanation,
      ...(markdownReport ? { markdownReport } : {})
    }
  };
}
