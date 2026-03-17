import fs from "fs";
import path from "path";
import { createLLMEngine } from "../../engines/llm";
import { LLMEngineSystemPromptMode } from "../../engines/llm/llm";
import { ensureDir, resolveDataPath } from "../../storage/persistence";

export type CodexMarkdownReportInput = {
  providerRaw?: unknown;
  taskPrefix?: string;
  sourceMarkdown: string;
  systemPrompt: string;
  userPrompt: string;
  outputDir?: string;
  modelOverride?: string;
  timeoutMs?: number;
  engineSystemPrompt?: string;
  engineSystemPromptMode?: LLMEngineSystemPromptMode;
};

export type CodexMarkdownReportResult = {
  provider: "codex";
  model: string;
  markdown: string;
  summary: string;
  generatedAt: string;
  inputPath: string;
  outputPath: string;
};

export function isCodexProvider(providerRaw: unknown): boolean {
  const selector = resolveLlmProviderSelector(providerRaw);
  const engine = createLLMEngine(selector);
  return engine.getProviderName() === "codex";
}

export async function runCodexMarkdownReport(input: CodexMarkdownReportInput): Promise<CodexMarkdownReportResult | null> {
  const selector = resolveLlmProviderSelector(input.providerRaw);
  const engine = createLLMEngine(selector);
  if (engine.getProviderName() !== "codex") {
    return null;
  }

  const model = normalizeText(input.modelOverride)
    || normalizeText(engine.getModelForStep("planning"))
    || normalizeText(engine.getModelForStep("routing"))
    || "";
  if (!model) {
    throw new Error("missing model for codex markdown report");
  }

  const outputDir = normalizeText(input.outputDir) || resolveDataPath("codex", "markdown-reports");
  ensureDir(outputDir);

  const taskId = buildTaskId(input.taskPrefix || "codex");
  const inputPath = path.join(outputDir, `${taskId}.input.md`);
  const outputPath = path.join(outputDir, `${taskId}.report.md`);
  const sourceMarkdown = normalizeMarkdown(input.sourceMarkdown);
  if (!sourceMarkdown) {
    throw new Error("sourceMarkdown is empty");
  }
  fs.writeFileSync(inputPath, sourceMarkdown, "utf-8");

  const markdown = await engine.chat({
    step: "general",
    model,
    ...(Number.isFinite(input.timeoutMs) && Number(input.timeoutMs) > 0 ? { timeoutMs: Math.floor(Number(input.timeoutMs)) } : {}),
    ...(normalizeText(input.engineSystemPrompt)
      ? {
          engineSystemPrompt: normalizeText(input.engineSystemPrompt),
          engineSystemPromptMode: input.engineSystemPromptMode
        }
      : {}),
    messages: [
      {
        role: "system",
        content: normalizeText(input.systemPrompt) || "请输出 markdown。"
      },
      {
        role: "user",
        content: [
          normalizeText(input.userPrompt) || "请阅读输入并输出 markdown。",
          `输入文件路径: ${inputPath}`,
          "",
          sourceMarkdown
        ].join("\n")
      }
    ]
  });

  const normalized = normalizeMarkdown(markdown);
  if (!normalized) {
    throw new Error("codex markdown report is empty");
  }
  fs.writeFileSync(outputPath, normalized, "utf-8");

  return {
    provider: "codex",
    model,
    markdown: normalized,
    summary: extractSummary(normalized),
    generatedAt: new Date().toISOString(),
    inputPath,
    outputPath
  };
}

function resolveLlmProviderSelector(raw: unknown): string | undefined {
  const value = normalizeText(raw).toLowerCase();
  if (!value || value === "local" || value === "default" || value === "auto") {
    return undefined;
  }
  if (["gpt_plugin", "gpt-plugin", "gptplugin", "chatgpt-bridge", "chatgpt_bridge", "bridge"].includes(value)) {
    return "gpt-plugin";
  }
  return value.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || undefined;
}

function buildTaskId(prefix: string): string {
  const normalized = String(prefix || "codex")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "codex";
  return `${normalized}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractSummary(markdown: string): string {
  const lines = String(markdown)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith("#")) {
      return line.slice(0, 160);
    }
  }
  return lines[0]?.slice(0, 160) || "已生成 markdown 报告。";
}

function normalizeMarkdown(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}
