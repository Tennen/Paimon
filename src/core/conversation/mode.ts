import { MainConversationMode } from "./types";

export const DEFAULT_MAIN_CONVERSATION_MODE: MainConversationMode = "classic";

export function normalizeMainConversationMode(raw: unknown): MainConversationMode {
  return raw === "windowed-agent" ? "windowed-agent" : "classic";
}

export function readMainConversationMode(raw: unknown = process.env.MAIN_CONVERSATION_MODE): MainConversationMode {
  return normalizeMainConversationMode(String(raw ?? "").trim().toLowerCase());
}

export function resolveMainConversationMode(meta: unknown): MainConversationMode {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const override = (meta as Record<string, unknown>).conversation_mode_override;
    if (override !== undefined && override !== null) {
      return normalizeMainConversationMode(String(override ?? "").trim().toLowerCase());
    }
  }
  return readMainConversationMode();
}
