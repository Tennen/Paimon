import { EnvConfigStore } from "../../config/envConfigStore";

export type CodexConfigSnapshot = {
  codexModel: string;
  codexReasoningEffort: string;
  envPath: string;
};

export type UpdateCodexConfigInput = {
  model?: string;
  reasoningEffort?: string;
};

const ALLOWED_REASONING_EFFORT = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export class EvolutionCodexConfigService {
  private readonly envStore: EnvConfigStore;

  constructor(envStore: EnvConfigStore) {
    this.envStore = envStore;
  }

  getConfig(): CodexConfigSnapshot {
    const envPath = this.envStore.getPath();
    const envValues = this.envStore.getAll();
    return {
      codexModel: resolveCodexModel(envValues),
      codexReasoningEffort: resolveCodexReasoningEffort(envValues),
      envPath
    };
  }

  updateConfig(input: UpdateCodexConfigInput): CodexConfigSnapshot {
    const hasModel = Object.prototype.hasOwnProperty.call(input, "model");
    const hasReasoningEffort = Object.prototype.hasOwnProperty.call(input, "reasoningEffort");
    if (!hasModel && !hasReasoningEffort) {
      throw new Error("model or reasoningEffort is required");
    }

    if (hasModel) {
      if (typeof input.model !== "string") {
        throw new Error("model must be a string");
      }
      const model = input.model.trim();
      if (model) {
        this.envStore.setValue("EVOLUTION_CODEX_MODEL", model);
      } else {
        this.envStore.unsetValue("EVOLUTION_CODEX_MODEL");
      }
    }

    if (hasReasoningEffort) {
      if (typeof input.reasoningEffort !== "string") {
        throw new Error("reasoningEffort must be a string");
      }
      const normalized = normalizeReasoningEffort(input.reasoningEffort);
      if (normalized === null) {
        throw new Error("reasoningEffort must be one of: minimal, low, medium, high, xhigh, or empty");
      }
      if (normalized) {
        this.envStore.setValue("EVOLUTION_CODEX_REASONING_EFFORT", normalized);
      } else {
        this.envStore.unsetValue("EVOLUTION_CODEX_REASONING_EFFORT");
      }
    }

    return this.getConfig();
  }
}

function normalizeReasoningEffort(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (!text) {
    return "";
  }
  if (!ALLOWED_REASONING_EFFORT.has(text)) {
    return null;
  }
  return text;
}

function resolveCodexModel(envValues: Record<string, string>): string {
  const candidates = [
    envValues.EVOLUTION_CODEX_MODEL,
    envValues.CODEX_MODEL,
    process.env.EVOLUTION_CODEX_MODEL,
    process.env.CODEX_MODEL
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function resolveCodexReasoningEffort(envValues: Record<string, string>): string {
  const candidates = [
    envValues.EVOLUTION_CODEX_REASONING_EFFORT,
    envValues.CODEX_MODEL_REASONING_EFFORT,
    envValues.CODEX_REASONING_EFFORT,
    process.env.EVOLUTION_CODEX_REASONING_EFFORT,
    process.env.CODEX_MODEL_REASONING_EFFORT,
    process.env.CODEX_REASONING_EFFORT
  ];
  for (const candidate of candidates) {
    const normalized = normalizeReasoningEffort(String(candidate ?? ""));
    if (normalized) {
      return normalized;
    }
  }
  return "";
}
