import { Envelope, Response, ToolExecution } from "../../types";
import { LLMExecutionStep, LLMEngine } from "../../engines/llm/llm";
import { SkillManager } from "../../skills/skillManager";
import { ToolRegistry } from "../../tools/toolRegistry";
import { ToolRouter } from "../../tools/toolRouter";
import { HybridMemoryService } from "../../memory/hybridMemoryService";
import { ConversationContextService } from "../../config/conversationContextService";

export type MainConversationMode = "classic" | "windowed-agent";

export type ConversationTurnInput = {
  text: string;
  envelope: Envelope;
  start: number;
  readSessionMemory: () => string;
};

export type ConversationRuntime = {
  handleTurn(input: ConversationTurnInput): Promise<Response>;
};

export type ConversationRuntimeSupportOptions = {
  toolRouter: ToolRouter;
  defaultLLMEngine: LLMEngine;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hybridMemoryService: HybridMemoryService;
  conversationContextService?: ConversationContextService;
  llmEngineResolver?: (step: LLMExecutionStep) => LLMEngine;
  writeLlmAudit: (envelope: Envelope, step: LLMExecutionStep, start: number, engine: LLMEngine) => void;
};

export type ToolExecutionResult = {
  result: { ok: boolean; output?: unknown; error?: string };
};

export type ExecuteToolFn = (
  toolExecution: ToolExecution,
  memory: string,
  envelope: Envelope
) => Promise<ToolExecutionResult>;
