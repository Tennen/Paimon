import fs from "fs";
import path from "path";
import dotenv from "dotenv";
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
    return {
      codexModel: resolveCodexModel(readEnvValues(envPath)),
      codexReasoningEffort: resolveCodexReasoningEffort(readEnvValues(envPath)),
      envPath
    };
  }

  updateConfig(input: UpdateCodexConfigInput): CodexConfigSnapshot {
    const envPath = this.envStore.getPath();
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
        setEnvValue(envPath, "EVOLUTION_CODEX_MODEL", model);
      } else {
        unsetEnvValue(envPath, "EVOLUTION_CODEX_MODEL");
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
        setEnvValue(envPath, "EVOLUTION_CODEX_REASONING_EFFORT", normalized);
      } else {
        unsetEnvValue(envPath, "EVOLUTION_CODEX_REASONING_EFFORT");
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

function readEnvValues(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const content = fs.readFileSync(envPath, "utf-8");
  return dotenv.parse(content);
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

function setEnvValue(envPath: string, key: string, value: string): void {
  const text = value.trim();
  if (!text) {
    throw new Error(`${key} cannot be empty`);
  }

  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8").split(/\r?\n/)
    : [];

  const escapedValue = formatEnvValue(text);
  const targetPrefix = `${key}=`;
  let replaced = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1] === key) {
      lines[i] = `${targetPrefix}${escapedValue}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(`${targetPrefix}${escapedValue}`);
  }

  fs.writeFileSync(envPath, `${lines.join("\n").replace(/\n+$/, "\n")}`, "utf-8");
  process.env[key] = text;
}

function unsetEnvValue(envPath: string, key: string): void {
  if (!fs.existsSync(envPath)) {
    delete process.env[key];
    return;
  }

  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  const nextLines = lines.filter((line) => {
    if (!line || /^\s*#/.test(line)) {
      return true;
    }
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return match?.[1] !== key;
  });
  fs.writeFileSync(envPath, `${nextLines.join("\n").replace(/\n+$/, "\n")}`, "utf-8");
  delete process.env[key];
}

function formatEnvValue(value: string): string {
  if (/[\s#"'`]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
