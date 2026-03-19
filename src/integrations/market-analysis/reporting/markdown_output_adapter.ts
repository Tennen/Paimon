import { renderMarkdownAsLongImage } from "../../user-message/markdownImageAdapter";
import { createMarketImagePipelineError } from "./pipeline_errors";

type ExplanationRecord = Record<string, unknown>;

export function getExplanationMarkdown(explanation: unknown): string {
  const source = isRecord(explanation) ? explanation : {};
  return String(source.markdown || "").trim();
}

export function requireExplanationMarkdown(explanation: unknown, reason = "markdown report is required when explanation is enabled"): string {
  const markdown = getExplanationMarkdown(explanation);
  if (!markdown) {
    throw createMarketImagePipelineError(reason);
  }
  return markdown;
}

export async function renderMarketExplanationImage(input: { phase: string; markdown: string }) {
  try {
    const image = await renderMarkdownAsLongImage({
      markdown: input.markdown,
      title: `Market Analysis ${input.phase}`,
      filenamePrefix: `market-${input.phase}`
    });
    if (!image || !image.data) {
      throw createMarketImagePipelineError("rendered image payload is empty");
    }
    return image;
  } catch (error) {
    if (isMarketPipelineError(error)) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error || "unknown error");
    throw createMarketImagePipelineError(`failed to render markdown image: ${detail}`, error);
  }
}

function isRecord(value: unknown): value is ExplanationRecord {
  return Boolean(value) && typeof value === "object";
}

function isMarketPipelineError(error: unknown): error is Error & { code: string } {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "MARKET_IMAGE_PIPELINE_FAILED";
}
