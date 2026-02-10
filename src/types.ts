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

export enum ActionType {
  Respond = "respond",
  SkillCall = "skill.call",
  ToolCall = "tool.call",
  LlmCall = "llm.call"
}

export type Action = {
  type: ActionType;
  rawType?: string;
  params: Record<string, unknown>;
};

export type Image = {
  data: string;
  contentType?: string;
  filename?: string;
};

export type ToolResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
};

export type Response = {
  text: string;
  data?: {
    image?: Image;
  };
};
