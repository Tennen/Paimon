export type Envelope = {
  requestId: string;
  source: string;
  sessionId: string;
  kind: string;
  text?: string;
  audioPath?: string;
  meta?: Record<string, unknown>;
  receivedAt: string;
};

export type Action = {
  type: string;
  params: Record<string, unknown>;
};

export type ToolResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
};

export type Response = {
  text: string;
  data?: unknown;
};
