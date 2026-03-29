export type CodexRunRequest = {
  taskId: string;
  prompt: string;
  timeoutMs?: number;
  model?: string;
  reasoningEffort?: string;
  onEvent?: (event: CodexRunEvent) => void;
};

export type CodexRunResult = {
  ok: boolean;
  output: string;
  error?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  rateLimited: boolean;
  rawTail: string[];
};

export type CodexRunEvent =
  | {
      type: "started";
      at: string;
      taskId: string;
      outputFile: string;
      timeoutMs: number;
    }
  | {
      type: "stdout" | "stderr";
      at: string;
      line: string;
    }
  | {
      type: "approval_required";
      at: string;
      taskId: string;
      prompt: string;
    }
  | {
      type: "approval_submitted";
      at: string;
      taskId: string;
      decision: "yes" | "no";
    }
  | {
      type: "timeout";
      at: string;
      timeoutMs: number;
    }
  | {
      type: "error";
      at: string;
      message: string;
    }
  | {
      type: "closed";
      at: string;
      code: number | null;
      signal: NodeJS.Signals | null;
      ok: boolean;
    };

export type CodexAdapterOptions = {
  rootDir: string;
  outputDir: string;
  timeoutMs: number;
  maxRawLines: number;
  model: string;
  reasoningEffort: string;
  approvalPolicy: string;
};

export type CodexPendingApproval = {
  taskId: string;
  at: string;
  prompt: string;
};

export type ActiveCodexRun = {
  stdin: NodeJS.WritableStream | null;
  onEvent?: CodexRunRequest["onEvent"];
};
