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

export type SkillSelectionResult = {
  decision: "respond" | "use_skill";
  skill_name?: string;
  planning_thinking_budget?: number;
  response_text?: string;
};

export type SkillPlanningResult = {
  tool: string;
  op: string;
  args: Record<string, unknown>;
  success_response: string;
  failure_response: string;
};

export type ToolExecution = {
  tool: string;
  op: string;
  args: Record<string, unknown>;
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
    images?: Image[];
    asyncTask?: {
      id: string;
      status: "accepted";
    };
  };
};
