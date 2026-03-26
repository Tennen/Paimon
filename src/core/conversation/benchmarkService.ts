import { SessionManager } from "../sessionManager";
import { MemoryStore } from "../../memory/memoryStore";
import { RawMemoryStore } from "../../memory/rawMemoryStore";
import { SummaryMemoryStore } from "../../memory/summaryMemoryStore";
import { SummaryVectorIndex } from "../../memory/summaryVectorIndex";
import { ConversationWindowService } from "../../memory/conversationWindowService";
import { MainConversationMode } from "./types";

export type ConversationBenchmarkRequest = {
  turns: string[];
  repeatCount: number;
  modes: MainConversationMode[];
};

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

export type ConversationBenchmarkServiceOptions = {
  sessionManager: SessionManager;
  memoryStore: MemoryStore;
  rawMemoryStore: RawMemoryStore;
  summaryMemoryStore: SummaryMemoryStore;
  summaryVectorIndex: SummaryVectorIndex;
  windowService: ConversationWindowService;
};

export class ConversationBenchmarkService {
  private readonly sessionManager: SessionManager;
  private readonly memoryStore: MemoryStore;
  private readonly rawMemoryStore: RawMemoryStore;
  private readonly summaryMemoryStore: SummaryMemoryStore;
  private readonly summaryVectorIndex: SummaryVectorIndex;
  private readonly windowService: ConversationWindowService;

  constructor(options: ConversationBenchmarkServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.memoryStore = options.memoryStore;
    this.rawMemoryStore = options.rawMemoryStore;
    this.summaryMemoryStore = options.summaryMemoryStore;
    this.summaryVectorIndex = options.summaryVectorIndex;
    this.windowService = options.windowService;
  }

  async run(request: ConversationBenchmarkRequest): Promise<ConversationBenchmarkResponse> {
    const turns = request.turns.map((item) => String(item ?? "").trim()).filter(Boolean);
    const repeatCount = Math.max(1, Math.min(10, Math.floor(request.repeatCount || 1)));
    const modes: MainConversationMode[] = request.modes.length > 0
      ? request.modes
      : ["classic", "windowed-agent"];

    const summaries: ConversationBenchmarkSummary[] = [];

    for (const mode of modes) {
      const conversations: ConversationBenchmarkConversationResult[] = [];
      for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
        const sessionId = `__benchmark__:${mode}:${Date.now().toString(36)}:${repeat}:${Math.random().toString(36).slice(2, 8)}`;
        try {
          const startedAt = Date.now();
          const turnResults: ConversationBenchmarkTurnResult[] = [];
          for (let i = 0; i < turns.length; i += 1) {
            const prompt = turns[i];
            const requestStartedAt = Date.now();
            const response = await this.sessionManager.enqueue({
              requestId: `${sessionId}:turn:${i + 1}`,
              sessionId,
              source: "admin-benchmark",
              kind: "text",
              text: prompt,
              receivedAt: new Date().toISOString(),
              meta: {
                conversation_mode_override: mode,
                benchmark: true
              }
            });
            turnResults.push({
              turnIndex: i + 1,
              prompt,
              latencyMs: Date.now() - requestStartedAt,
              responseText: String(response.text ?? "")
            });
          }
          conversations.push({
            repeat,
            totalMs: Date.now() - startedAt,
            turns: turnResults
          });
        } finally {
          this.cleanupSession(sessionId);
        }
      }
      summaries.push(summarizeMode(mode, repeatCount, turns.length, conversations));
    }

    return {
      ok: true,
      summaries
    };
  }

  private cleanupSession(sessionId: string): void {
    this.memoryStore.clear(sessionId);
    this.rawMemoryStore.clear(sessionId);
    this.summaryMemoryStore.clear(sessionId);
    this.summaryVectorIndex.clear(sessionId);
    this.windowService.clear(sessionId);
  }
}

function summarizeMode(
  mode: MainConversationMode,
  repeatCount: number,
  turnCount: number,
  conversations: ConversationBenchmarkConversationResult[]
): ConversationBenchmarkSummary {
  const allTurnLatencies = conversations.flatMap((item) => item.turns.map((turn) => turn.latencyMs)).sort((a, b) => a - b);
  const totalMs = conversations.reduce((sum, item) => sum + item.totalMs, 0);
  const totalTurns = allTurnLatencies.length;
  const p95Index = totalTurns === 0 ? -1 : Math.min(totalTurns - 1, Math.max(0, Math.ceil(totalTurns * 0.95) - 1));

  return {
    mode,
    repeatCount,
    turnCount,
    totalMs,
    avgConversationMs: conversations.length > 0 ? Math.round(totalMs / conversations.length) : 0,
    avgTurnMs: totalTurns > 0 ? Math.round(allTurnLatencies.reduce((sum, item) => sum + item, 0) / totalTurns) : 0,
    p95TurnMs: p95Index >= 0 ? allTurnLatencies[p95Index] : 0,
    conversations
  };
}
