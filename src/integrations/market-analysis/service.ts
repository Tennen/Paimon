// @ts-nocheck
import { parseCommand } from "./commands";
import {
  buildHelpText,
  buildRunResponseText,
  formatPortfolio,
  formatPortfolioAddResult,
  formatStatus
} from "./formatters";
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
  return {
    text: buildRunResponseText(result),
    result: {
      runId: result.persisted.id,
      phase: result.signalResult.phase,
      marketState: result.signalResult.marketState,
      generatedAt: result.signalResult.generatedAt,
      signalResult: result.signalResult,
      explanation: result.explanation
    }
  };
}
