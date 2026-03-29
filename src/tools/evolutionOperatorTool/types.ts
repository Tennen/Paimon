export type EvolutionServiceBridge = {
  getTickMs: () => number;
  getSnapshot: () => unknown;
  enqueueGoal: (input: { goal: string; commitMessage?: string }) => Promise<unknown>;
  triggerNow: () => Promise<void>;
  triggerNowAsync?: () => void | Promise<void>;
  listPendingCodexApprovals?: (goalId?: string) => Array<{ taskId: string; at: string; prompt: string; goalId?: string }>;
  submitCodexApproval?: (input: {
    decision: "yes" | "no";
    goalId?: string;
    taskId?: string;
  }) => { ok: boolean; message: string; taskId?: string; goalId?: string };
  getCodexConfig: () => { codexModel: string; codexReasoningEffort: string; envPath: string };
  updateCodexConfig: (input: { model?: string; reasoningEffort?: string }) => {
    codexModel: string;
    codexReasoningEffort: string;
    envPath: string;
  };
};

export type EvolutionRuntimeContext = Record<string, unknown> & {
  evolution?: EvolutionServiceBridge;
};

export type ParsedEvolutionCommand = {
  scope: "evolution" | "codex";
  kind: string;
  goalId?: string;
  keyword?: string;
  decision?: "yes" | "no";
  taskId?: string;
  commitMessage?: string;
  model?: string;
  reasoningEffort?: string;
  goal?: string;
};
