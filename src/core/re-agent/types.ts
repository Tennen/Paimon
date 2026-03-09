export const RE_AGENT_COMMAND_PREFIX = "/re";

export const RE_AGENT_HELP_TOKENS = ["help", "h", "?", "帮助"] as const;
export const RE_AGENT_RESET_TOKENS = ["reset", "clear", "重置", "清空"] as const;

export type ReAgentCommandKind = "ask" | "help" | "reset";

export type ReAgentCommand = {
  kind: ReAgentCommandKind;
  rawInput: string;
  prefixedInput: string;
  content: string;
};

export type ReAgentToolAction = {
  kind: "tool";
  thought?: string;
  tool: string;
  action: string;
  params: Record<string, unknown>;
};

export type ReAgentRespondAction = {
  kind: "respond";
  thought?: string;
  response: string;
};

export type ReActAction = ReAgentToolAction | ReAgentRespondAction;

export type ReActObservation = {
  ok: boolean;
  output?: unknown;
  error?: string;
};

export type ReAgentTraceStep = {
  step: number;
  action: ReActAction;
  observation?: ReActObservation;
};

export type ReAgentModuleContext = {
  sessionId: string;
  input: string;
  step: number;
  maxSteps: number;
  history: ReAgentTraceStep[];
};

export type ReAgentModuleResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
};

export type ReAgentModule = {
  name: string;
  description?: string;
  execute: (
    action: string,
    params: Record<string, unknown>,
    context: ReAgentModuleContext
  ) => Promise<ReAgentModuleResult>;
};
