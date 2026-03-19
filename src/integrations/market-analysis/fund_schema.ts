export type FundDecisionType = "buy" | "add" | "hold" | "reduce" | "redeem" | "watch";

export type FeatureCoverage = "ok" | "partial" | "insufficient";

export type FundDecisionDashboard = {
  fund_code: string;
  fund_name: string;
  as_of_date: string;
  decision_type: FundDecisionType;
  sentiment_score: number;
  confidence: number;
  core_conclusion: {
    one_sentence: string;
    thesis: string[];
  };
  risk_alerts: string[];
  action_plan: {
    suggestion: string;
    position_change: string;
    execution_conditions: string[];
    stop_conditions: string[];
  };
  data_perspective: {
    return_metrics: Record<string, number | string | null>;
    risk_metrics: Record<string, number | string | null>;
    relative_metrics: Record<string, number | string | null>;
    feature_coverage: FeatureCoverage;
  };
  rule_trace: {
    rule_flags: string[];
    blocked_actions: string[];
    adjusted_score: number;
  };
  insufficient_data: {
    is_insufficient: boolean;
    missing_fields: string[];
  };
};

export type FundDashboardValidationResult = {
  dashboard: FundDecisionDashboard;
  missingFields: string[];
  isValid: boolean;
};

const DECISION_TYPES: FundDecisionType[] = ["buy", "add", "hold", "reduce", "redeem", "watch"];
const COVERAGE_TYPES: FeatureCoverage[] = ["ok", "partial", "insufficient"];

export function validateFundDecisionDashboard(
  input: unknown,
  fallback: FundDecisionDashboard
): FundDashboardValidationResult {
  const source = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};

  const fund_code = readString(source.fund_code, fallback.fund_code);
  const fund_name = readString(source.fund_name, fallback.fund_name);
  const as_of_date = readString(source.as_of_date, fallback.as_of_date);

  const decisionRaw = readString(source.decision_type, fallback.decision_type);
  const decision_type = DECISION_TYPES.includes(decisionRaw as FundDecisionType)
    ? (decisionRaw as FundDecisionType)
    : fallback.decision_type;

  const sentiment_score = clamp(readNumber(source.sentiment_score, fallback.sentiment_score), 0, 100);
  const confidence = clamp(readNumber(source.confidence, fallback.confidence), 0, 1);

  const core = (source.core_conclusion && typeof source.core_conclusion === "object")
    ? (source.core_conclusion as Record<string, unknown>)
    : {};

  const action = (source.action_plan && typeof source.action_plan === "object")
    ? (source.action_plan as Record<string, unknown>)
    : {};

  const perspective = (source.data_perspective && typeof source.data_perspective === "object")
    ? (source.data_perspective as Record<string, unknown>)
    : {};

  const ruleTrace = (source.rule_trace && typeof source.rule_trace === "object")
    ? (source.rule_trace as Record<string, unknown>)
    : {};

  const insufficient = (source.insufficient_data && typeof source.insufficient_data === "object")
    ? (source.insufficient_data as Record<string, unknown>)
    : {};

  const coverageRaw = readString(perspective.feature_coverage, fallback.data_perspective.feature_coverage);
  const featureCoverage = COVERAGE_TYPES.includes(coverageRaw as FeatureCoverage)
    ? (coverageRaw as FeatureCoverage)
    : fallback.data_perspective.feature_coverage;

  const dashboard: FundDecisionDashboard = {
    fund_code,
    fund_name,
    as_of_date,
    decision_type,
    sentiment_score,
    confidence,
    core_conclusion: {
      one_sentence: readString(core.one_sentence, fallback.core_conclusion.one_sentence),
      thesis: readStringList(core.thesis, fallback.core_conclusion.thesis)
    },
    risk_alerts: readStringList(source.risk_alerts, fallback.risk_alerts),
    action_plan: {
      suggestion: readString(action.suggestion, fallback.action_plan.suggestion),
      position_change: readString(action.position_change, fallback.action_plan.position_change),
      execution_conditions: readStringList(action.execution_conditions, fallback.action_plan.execution_conditions),
      stop_conditions: readStringList(action.stop_conditions, fallback.action_plan.stop_conditions)
    },
    data_perspective: {
      return_metrics: normalizeMetricMap(perspective.return_metrics, fallback.data_perspective.return_metrics),
      risk_metrics: normalizeMetricMap(perspective.risk_metrics, fallback.data_perspective.risk_metrics),
      relative_metrics: normalizeMetricMap(perspective.relative_metrics, fallback.data_perspective.relative_metrics),
      feature_coverage: featureCoverage
    },
    rule_trace: {
      rule_flags: readStringList(ruleTrace.rule_flags, fallback.rule_trace.rule_flags),
      blocked_actions: readStringList(ruleTrace.blocked_actions, fallback.rule_trace.blocked_actions),
      adjusted_score: clamp(readNumber(ruleTrace.adjusted_score, fallback.rule_trace.adjusted_score), 0, 100)
    },
    insufficient_data: {
      is_insufficient: readBoolean(insufficient.is_insufficient, fallback.insufficient_data.is_insufficient),
      missing_fields: readStringList(insufficient.missing_fields, fallback.insufficient_data.missing_fields)
    }
  };

  const missingFields: string[] = [];
  if (!dashboard.fund_code) missingFields.push("fund_code");
  if (!dashboard.fund_name) missingFields.push("fund_name");
  if (!dashboard.as_of_date) missingFields.push("as_of_date");
  if (!dashboard.core_conclusion.one_sentence) missingFields.push("core_conclusion.one_sentence");
  if (!dashboard.action_plan.suggestion) missingFields.push("action_plan.suggestion");

  const isValid = missingFields.length === 0;
  return {
    dashboard,
    missingFields,
    isValid
  };
}

export function buildFallbackFundDashboard(input: {
  fundCode: string;
  fundName: string;
  asOfDate: string;
  featureCoverage: FeatureCoverage;
  adjustedScore: number;
  ruleFlags: string[];
  blockedActions: string[];
  insufficient: boolean;
  missingFields: string[];
}): FundDecisionDashboard {
  const score = clamp(input.adjustedScore, 0, 100);
  const decision = chooseFallbackDecision(score, input.blockedActions, input.insufficient);

  return {
    fund_code: input.fundCode,
    fund_name: input.fundName,
    as_of_date: input.asOfDate,
    decision_type: decision,
    sentiment_score: Math.round(score),
    confidence: input.insufficient ? 0.25 : 0.55,
    core_conclusion: {
      one_sentence: input.insufficient
        ? "目前数据不完整，这个判断不太可靠，建议先等等。"
        : "在现有规则和数据下，这是一个偏保守的判断结果。",

      thesis: input.insufficient
        ? [
            "关键数据还不齐（比如净值或价格）",
            "当前更重要的是先控制风险"
          ]
        : [
            "优先遵守风控规则（有红线不能碰）",
            "在这些限制下给出一个稳妥的建议"
          ]
    },
    risk_alerts: input.ruleFlags.slice(0, 6),
    action_plan: {
      suggestion: decision === "watch"
        ? "先别动，继续观察一段时间更稳妥。"
        : "可以行动，但要严格避开被限制的操作。",

      position_change: decisionToPositionChange(decision),
      execution_conditions: [
        "数据恢复正常、更新及时",
        "没有出现新的风险信号"
      ],
      stop_conditions: [
        "出现新的高风险提示",
        "连续两次数据质量不足"
      ]
    },
    data_perspective: {
      return_metrics: {},
      risk_metrics: {},
      relative_metrics: {},
      feature_coverage: input.featureCoverage
    },
    rule_trace: {
      rule_flags: input.ruleFlags,
      blocked_actions: input.blockedActions,
      adjusted_score: score
    },
    insufficient_data: {
      is_insufficient: input.insufficient,
      missing_fields: input.missingFields
    }
  };
}

function chooseFallbackDecision(
  adjustedScore: number,
  blockedActions: string[],
  insufficient: boolean
): FundDecisionType {
  if (insufficient) {
    return "watch";
  }

  const blocked = new Set(blockedActions.map((item) => item.trim().toLowerCase()).filter(Boolean));

  let decision: FundDecisionType;
  if (adjustedScore >= 75) {
    decision = "add";
  } else if (adjustedScore >= 58) {
    decision = "hold";
  } else if (adjustedScore >= 40) {
    decision = "reduce";
  } else {
    decision = "redeem";
  }

  if (blocked.has(decision)) {
    return "hold";
  }
  if (blocked.has("buy") && blocked.has("add") && decision === "add") {
    return "hold";
  }
  return decision;
}

function decisionToPositionChange(decision: FundDecisionType): string {
  switch (decision) {
    case "buy":
      return "新建仓位（小仓位试探）";
    case "add":
      return "在风险预算内小幅加仓";
    case "hold":
      return "维持当前仓位";
    case "reduce":
      return "先减仓再观察";
    case "redeem":
      return "分批赎回";
    case "watch":
    default:
      return "观望";
  }
}

function normalizeMetricMap(
  input: unknown,
  fallback: Record<string, number | string | null>
): Record<string, number | string | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...fallback };
  }

  const source = input as Record<string, unknown>;
  const out: Record<string, number | string | null> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!key.trim()) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.trim();
      continue;
    }
    if (value === null) {
      out[key] = null;
    }
  }

  return Object.keys(out).length > 0 ? out : { ...fallback };
}

function readString(input: unknown, fallback: string): string {
  return typeof input === "string" ? input.trim() : fallback;
}

function readNumber(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function readBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function readStringList(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) {
    return fallback.slice();
  }
  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
