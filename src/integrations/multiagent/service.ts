export type MultiAgentVerdict = "approved" | "revise";

export type MultiAgentCollaborateRequest = {
  goal: string;
  sessionId?: string;
  context?: string;
};

export type MultiAgentCollaborateResult = {
  goal: string;
  sessionId: string;
  planner: { role: "planner"; content: string };
  critic: { role: "critic"; content: string; verdict: MultiAgentVerdict };
  final: string;
};

export type MultiAgentPlanner = (input: MultiAgentCollaborateRequest) => Promise<string>;
export type MultiAgentCriticInput = MultiAgentCollaborateRequest & { plan: string };
export type MultiAgentCritic = (
  input: MultiAgentCriticInput
) => Promise<string | { content: string; verdict?: MultiAgentVerdict }>;

export type MultiAgentServiceConfig = {
  planner?: MultiAgentPlanner;
  critic?: MultiAgentCritic;
};

export class MultiAgentService {
  private readonly planner: MultiAgentPlanner;
  private readonly critic: MultiAgentCritic;

  constructor(config: MultiAgentServiceConfig = {}) {
    this.planner = config.planner ?? defaultPlanner;
    this.critic = config.critic ?? defaultCritic;
  }

  async collaborate(input: MultiAgentCollaborateRequest): Promise<MultiAgentCollaborateResult> {
    const goal = normalizeText(input.goal);
    const sessionId = normalizeText(input.sessionId);
    const context = normalizeText(input.context);

    const plannerContent = normalizeText(
      await this.planner({
        goal,
        sessionId,
        ...(context ? { context } : {})
      })
    ) || buildFallbackPlan(goal, context);

    const criticRaw = await this.critic({
      goal,
      sessionId,
      ...(context ? { context } : {}),
      plan: plannerContent
    });

    const criticContent = normalizeText(
      typeof criticRaw === "string" ? criticRaw : criticRaw.content
    );
    const verdict =
      typeof criticRaw === "string"
        ? inferVerdict(criticRaw)
        : criticRaw.verdict ?? inferVerdict(criticRaw.content);

    return {
      goal,
      sessionId,
      planner: { role: "planner", content: plannerContent },
      critic: {
        role: "critic",
        content: criticContent || buildFallbackCritic(verdict),
        verdict
      },
      final:
        verdict === "approved"
          ? plannerContent
          : `${plannerContent}\n\n[critic] ${criticContent || "建议补充关键细节后重试。"}`
    };
  }
}

async function defaultPlanner(input: MultiAgentCollaborateRequest): Promise<string> {
  return buildFallbackPlan(normalizeText(input.goal), normalizeText(input.context));
}

async function defaultCritic(
  input: MultiAgentCriticInput
): Promise<{ content: string; verdict: MultiAgentVerdict }> {
  const plan = normalizeText(input.plan);
  const needsRevision = plan.length < 36 || !/(^|\n)1[.)]/.test(plan);

  if (needsRevision) {
    return {
      verdict: "revise",
      content: "计划较粗略，请补充步骤编号、预期结果与风险处理。"
    };
  }

  return {
    verdict: "approved",
    content: "计划可执行，建议按顺序推进并在每步后复盘。"
  };
}

function buildFallbackPlan(goal: string, context: string): string {
  return [
    `目标: ${goal || "未提供目标"}`,
    `上下文: ${context || "无"}`,
    "1) 明确输入与约束条件。",
    "2) 产出最小可验证方案并执行。",
    "3) 记录结果并根据反馈调整下一步。"
  ].join("\n");
}

function buildFallbackCritic(verdict: MultiAgentVerdict): string {
  return verdict === "approved" ? "计划可执行。" : "建议补充关键细节后重试。";
}

function inferVerdict(text: string): MultiAgentVerdict {
  const normalized = normalizeText(text).toLowerCase();
  return /(revise|修改|补充|风险|不足|不通过)/.test(normalized) ? "revise" : "approved";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
