import { InternalChatRequest, resolveEngineSystemPrompt } from "../chat_engine";
import type { CodexApprovalPolicy, CodexReasoningEffort, CodexSandboxMode } from "./types";

export function buildCodexPrompt(request: InternalChatRequest): string {
  const messageText = request.messages
    .map((message, index) => formatMessageForPrompt(index + 1, message))
    .join("\n\n");
  const systemPrompt = resolveEngineSystemPrompt({
    defaultPrompt: [
      "You are acting as an LLM backend for an automation runtime.",
      "Read the provided conversation messages and output only the assistant reply body.",
      "Do not execute side-effectful operations and do not modify workspace files.",
      "If the messages require strict JSON, output strict JSON only.",
      "Do not output markdown fences."
    ].join("\n"),
    customPrompt: request.engineSystemPrompt,
    mode: request.engineSystemPromptMode
  });

  return [
    systemPrompt,
    `step: ${request.step}`,
    `model_hint: ${request.model}`,
    "",
    "<messages>",
    messageText,
    "</messages>"
  ].join("\n");
}

export function buildCodexArgs(input: {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  outputFile: string;
  prompt: string;
  model: string;
  reasoningEffort: CodexReasoningEffort | "";
}): string[] {
  const args = [
    "-a",
    input.approvalPolicy,
    "exec",
    "--json",
    "--sandbox",
    input.sandbox,
    "-o",
    input.outputFile,
    input.prompt
  ];

  const model = String(input.model ?? "").trim();
  if (model) {
    args.splice(args.length - 1, 0, "--model", model);
  }

  if (input.reasoningEffort) {
    args.splice(args.length - 1, 0, "--config", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`);
  }

  return args;
}

function formatMessageForPrompt(
  index: number,
  message: { role: "system" | "user" | "assistant"; content: string; images?: string[] }
): string {
  const images = Array.isArray(message.images)
    ? message.images.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];
  const lines = [
    `#${index} role=${message.role}`,
    String(message.content ?? "")
  ];
  if (images.length > 0) {
    lines.push(`[images: ${images.length}]`);
  }
  return lines.join("\n");
}
