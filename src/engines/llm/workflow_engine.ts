import { LLMEngine, LLMProvider } from "./llm";
import { LlamaServerLLMEngine } from "./llama-server";
import { OllamaLLMEngine } from "./ollama";

export { LLMWorkflowEngine } from "./workflow_runtime";
export type { WorkflowStepRequest } from "./workflow_runtime";

export function createLLMEngine(providerRaw: string | undefined = process.env.LLM_PROVIDER): LLMEngine {
  const provider = normalizeProvider(providerRaw);
  if (provider === "llama-server") {
    return new LlamaServerLLMEngine();
  }
  return new OllamaLLMEngine();
}

export function normalizeProvider(providerRaw: string | undefined): LLMProvider {
  const value = String(providerRaw ?? "").trim().toLowerCase();
  if (!value) {
    return "ollama";
  }
  if (["llama-server", "llama_server", "llama.cpp", "llamacpp", "llama"].includes(value)) {
    return "llama-server";
  }
  if (value !== "ollama") {
    console.warn(`[LLM] unknown provider '${providerRaw}', fallback to ollama`);
  }
  return "ollama";
}
