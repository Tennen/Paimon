import { InternalChatRequest, resolveEngineSystemPrompt } from "../chat_engine";
import { isRecord, normalizeText } from "./shared";

export function buildBridgeFallbackPrompt(request: InternalChatRequest, reason: string): string {
  const messageText = request.messages
    .map((message, index) => formatBridgeMessage(message, index + 1))
    .join("\n\n");
  const systemPrompt = resolveEngineSystemPrompt({
    defaultPrompt: [
      "You are acting as a fallback model for an automation runtime.",
      "Read the message list and answer exactly as the assistant.",
      "If the prompt asks for strict JSON, output strict JSON only."
    ].join("\n"),
    customPrompt: request.engineSystemPrompt,
    mode: request.engineSystemPromptMode
  });

  return [
    systemPrompt,
    `fallback_reason: ${reason}`,
    `step: ${request.step}`,
    `model_hint: ${request.model}`,
    "",
    "<messages>",
    messageText,
    "</messages>"
  ].join("\n");
}

export function extractTextFromBridgeResponse(response: unknown): string {
  if (typeof response === "string") {
    return response.trim();
  }
  if (!isRecord(response)) {
    return "";
  }
  const directText = normalizeText(response.text);
  if (directText) {
    return directText;
  }
  return isRecord(response.output) ? normalizeText(response.output.text) : "";
}

function formatBridgeMessage(
  message: { role: "system" | "user" | "assistant"; content: string; images?: string[] },
  index: number
): string {
  const images = Array.isArray(message.images) ? message.images.filter((item) => typeof item === "string" && item.trim()) : [];
  const lines = [
    `#${index} role=${message.role}`,
    String(message.content ?? "")
  ];
  if (images.length > 0) {
    lines.push(`[images: ${images.length}]`);
  }
  return lines.join("\n");
}
