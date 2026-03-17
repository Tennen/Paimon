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
const MARKET_IMAGE_PIPELINE_FAILED = "MARKET_IMAGE_PIPELINE_FAILED";

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

  const text = withExplanation ? "" : buildRunResponseText(result);
  let image = null;
  const markdownReport = String(result.explanation && result.explanation.markdown || "").trim();
  if (withExplanation && !markdownReport) {
    throw createMarketImagePipelineError("missing markdown report for explanation mode");
  }
  if (withExplanation) {
    try {
      image = await renderMarkdownAsLongImage({
        markdown: markdownReport,
        title: `Market Analysis ${phase}`,
        filenamePrefix: `market-${phase}`
      });
    } catch (error) {
      const detail = (error && error.message) ? error.message : String(error || "unknown error");
      throw createMarketImagePipelineError(`failed to render markdown image: ${detail}`, error);
    }
    if (!image || !image.data) {
      throw createMarketImagePipelineError("rendered image payload is empty");
    }
  }

  return {
    text,
    ...(withExplanation ? { image } : {}),
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

function createMarketImagePipelineError(reason, cause) {
  const detail = String(reason || "unknown error").trim() || "unknown error";
  const error = new Error(`${MARKET_IMAGE_PIPELINE_FAILED}: ${detail}`);
  error.code = MARKET_IMAGE_PIPELINE_FAILED;
  if (cause) {
    error.cause = cause;
  }
  return error;
}
