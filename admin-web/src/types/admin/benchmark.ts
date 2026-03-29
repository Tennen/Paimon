import type { MainConversationMode } from "./system";

export type ConversationBenchmarkTurnResult = {
  turnIndex: number;
  prompt: string;
  latencyMs: number;
  responseText: string;
};

export type ConversationBenchmarkConversationResult = {
  repeat: number;
  totalMs: number;
  turns: ConversationBenchmarkTurnResult[];
};

export type ConversationBenchmarkSummary = {
  mode: MainConversationMode;
  repeatCount: number;
  turnCount: number;
  totalMs: number;
  avgConversationMs: number;
  avgTurnMs: number;
  p95TurnMs: number;
  conversations: ConversationBenchmarkConversationResult[];
};

export type ConversationBenchmarkResponse = {
  ok: true;
  summaries: ConversationBenchmarkSummary[];
};
