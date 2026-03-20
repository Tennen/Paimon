import { Image } from "../../../types";
import { renderMarkdownToImages } from "../../md2img";
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
    const rendered = await renderMarkdownToImages({
      markdown: input.markdown,
      mode: "long-image"
    });
    const image = toUserImage(rendered.images[0], input.phase);
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

function toUserImage(buffer: Buffer | undefined, phase: string): Image {
  if (!buffer || buffer.length === 0) {
    throw createMarketImagePipelineError("rendered image payload is empty");
  }

  const normalizedPhase = String(phase || "").trim().toLowerCase() || "report";
  return {
    data: buffer.toString("base64"),
    contentType: "image/png",
    filename: `market-${normalizedPhase}-${Date.now()}.png`
  };
}
