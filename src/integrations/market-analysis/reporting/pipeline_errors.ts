export const MARKET_IMAGE_PIPELINE_FAILED = "MARKET_IMAGE_PIPELINE_FAILED";

export function createMarketImagePipelineError(reason: unknown, cause?: unknown): Error & { code: string; cause?: unknown } {
  const detail = String(reason || "unknown error").trim() || "unknown error";
  const error = new Error(`${MARKET_IMAGE_PIPELINE_FAILED}: ${detail}`) as Error & { code: string; cause?: unknown };
  error.code = MARKET_IMAGE_PIPELINE_FAILED;
  if (cause) {
    error.cause = cause;
  }
  return error;
}
