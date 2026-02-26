import { Envelope } from "../types";
import { FastWhisperSTTProvider } from "./fastWhisperProvider";
import { MockSTTProvider } from "./mockProvider";
import { STTInput, STTProvider } from "./types";

const DEFAULT_STT_PROVIDER = "fast-whisper";

export class STTRuntime {
  private provider: STTProvider;
  private readonly fallbackProvider: STTProvider;

  constructor(provider?: STTProvider, fallbackProvider?: STTProvider) {
    this.provider = provider ?? createSTTProviderFromEnv();
    this.fallbackProvider = fallbackProvider ?? new MockSTTProvider();
  }

  getProviderName(): string {
    return this.provider.name;
  }

  async init(): Promise<void> {
    if (!this.provider.ensureReady) {
      return;
    }

    try {
      await this.provider.ensureReady();
    } catch (error) {
      console.error(`[stt] provider ${this.provider.name} init failed:`, error);
      if (this.provider.name !== this.fallbackProvider.name) {
        this.provider = this.fallbackProvider;
        console.warn(`[stt] fallback to provider: ${this.provider.name}`);
      }
    }
  }

  async transcribe(envelope: Pick<Envelope, "text" | "audioPath" | "meta">): Promise<string> {
    const text = normalizeText(envelope.text);
    if (text) {
      return text;
    }

    const input: STTInput = {
      text: undefined,
      audioPath: envelope.audioPath,
      meta: envelope.meta
    };

    try {
      const output = await this.provider.transcribe(input);
      const normalized = normalizeText(output);
      return normalized || "(stt empty)";
    } catch (error) {
      console.error(`[stt] provider ${this.provider.name} transcribe failed:`, error);
      if (this.provider.name !== this.fallbackProvider.name) {
        try {
          const fallback = await this.fallbackProvider.transcribe(input);
          const normalized = normalizeText(fallback);
          if (normalized) {
            return normalized;
          }
        } catch (fallbackError) {
          console.error("[stt] fallback provider failed:", fallbackError);
        }
      }

      return "(stt failed)";
    }
  }
}

export function createSTTProviderFromEnv(): STTProvider {
  const providerName = normalizeProviderName(process.env.STT_PROVIDER);
  if (providerName === "mock") {
    return new MockSTTProvider();
  }
  if (providerName === "fast-whisper") {
    return new FastWhisperSTTProvider();
  }

  console.warn(`[stt] unknown STT_PROVIDER=${process.env.STT_PROVIDER}, fallback to ${DEFAULT_STT_PROVIDER}`);
  return new FastWhisperSTTProvider();
}

export const sttRuntime = new STTRuntime();

function normalizeProviderName(input: string | undefined): string {
  const normalized = (input ?? DEFAULT_STT_PROVIDER).trim().toLowerCase();
  if (normalized === "fast_whisper" || normalized === "fastwhisper") {
    return "fast-whisper";
  }
  return normalized;
}

function normalizeText(input: string | undefined): string {
  if (!input) {
    return "";
  }
  return input.trim();
}
