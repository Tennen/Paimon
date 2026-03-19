// @ts-nocheck
import { parseCommand } from "./commands";
import {
  buildHelpText,
  buildRunResponseText,
  formatPortfolio,
  formatPortfolioAddResult,
  formatStatus
} from "./formatters";
import { renderMarketExplanationImage, requireExplanationMarkdown } from "./reporting/markdown_output_adapter";
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
  const result = await runAnalysis(phase, withExplanation);

  const text = withExplanation ? "" : buildRunResponseText(result);
  let image = null;
  const markdownReport = withExplanation
    ? requireExplanationMarkdown(result.explanation, "missing markdown report for explanation mode")
    : "";
  if (withExplanation) {
    image = await renderMarketExplanationImage({
      phase,
      markdown: markdownReport
    });
  }

  return {
    text,
    ...(withExplanation ? { image } : {}),
    result: {
      runId: result.persisted.id,
      phase: result.signalResult.phase,
      assetType: result.signalResult.assetType || "fund",
      marketState: result.signalResult.marketState,
      generatedAt: result.signalResult.generatedAt,
      signalResult: result.signalResult,
      explanation: result.explanation,
      ...(markdownReport ? { markdownReport } : {})
    }
  };
}
