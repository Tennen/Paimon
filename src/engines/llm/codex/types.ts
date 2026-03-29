export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type CodexLLMOptions = {
  model: string;
  planningModel: string;
  reasoningEffort: CodexReasoningEffort | "";
  planningReasoningEffort: CodexReasoningEffort | "";
  timeoutMs: number;
  planningTimeoutMs: number;
  maxRetries: number;
  strictJson: boolean;
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  rootDir: string;
  outputDir: string;
};

export type CodexExecutionResult = {
  ok: boolean;
  output: string;
  error: string;
};
