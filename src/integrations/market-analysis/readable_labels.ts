const ACTION_LABELS: Record<string, string> = {
  buy: "买入",
  add: "加仓",
  hold: "持有",
  reduce: "减仓",
  redeem: "赎回",
  watch: "观察"
};

const RULE_FLAG_LABELS: Record<string, string> = {
  data_stale: "数据时效性不足",
  feature_coverage_insufficient: "关键特征不足",
  feature_coverage_partial: "部分特征缺失",
  subscription_redemption_restriction: "存在申购赎回限制",
  regulatory_risk_event: "存在监管或异常风险",
  risk_level_exceeded: "波动或回撤超出风险预算",
  high_drawdown_penalty: "近期回撤偏深",
  manager_change_penalty: "基金经理变更需观察",
  cost_fee_penalty: "持仓成本或费率拖累"
};

export function formatActionLabel(raw: unknown): string {
  const text = normalizeText(raw);
  if (!text) {
    return "-";
  }
  const key = text.toLowerCase();
  return ACTION_LABELS[key] || text;
}

export function formatActionList(input: unknown, fallback = "无"): string {
  const items = toReadableList(input, formatActionLabel);
  return items.length > 0 ? items.join("、") : fallback;
}

export function formatRuleFlagLabel(raw: unknown): string {
  const text = normalizeText(raw);
  if (!text) {
    return "-";
  }
  const key = text.toLowerCase();
  return RULE_FLAG_LABELS[key] || text;
}

export function formatRuleFlagList(input: unknown, fallback = "无"): string {
  const items = toReadableList(input, formatRuleFlagLabel);
  return items.length > 0 ? items.join("；") : fallback;
}

export function formatInvestorReadableText(raw: unknown): string {
  const text = normalizeText(raw);
  if (!text) {
    return "";
  }
  const key = text.toLowerCase();
  if (RULE_FLAG_LABELS[key]) {
    return RULE_FLAG_LABELS[key];
  }
  if (ACTION_LABELS[key]) {
    return ACTION_LABELS[key];
  }
  return text;
}

export function formatInvestorReadableList(input: unknown, limit?: number): string[] {
  const items = toReadableList(input, formatInvestorReadableText);
  if (typeof limit === "number" && limit >= 0) {
    return items.slice(0, limit);
  }
  return items;
}

export function describeEvidenceStrength(confidenceRaw: unknown): string {
  const confidence = toFiniteNumber(confidenceRaw);
  if (confidence === null) {
    return "证据支撑程度未知";
  }
  if (confidence >= 0.82) {
    return "证据支撑较充分";
  }
  if (confidence >= 0.65) {
    return "证据支撑尚可";
  }
  if (confidence >= 0.45) {
    return "证据支撑一般，仍需继续验证";
  }
  return "证据支撑有限，建议保守解读";
}

export function describeSignalStrength(scoreRaw: unknown, confidenceRaw: unknown): string {
  return `信号${describeSignalTilt(scoreRaw)}，${describeEvidenceStrength(confidenceRaw)}`;
}

export function describeRuleTilt(scoreRaw: unknown, hardBlocked = false): string {
  if (hardBlocked) {
    return "强制保守";
  }
  const score = toFiniteNumber(scoreRaw);
  if (score === null) {
    return "待确认";
  }
  if (score >= 75) {
    return "偏积极";
  }
  if (score >= 60) {
    return "偏稳健";
  }
  if (score >= 45) {
    return "偏谨慎";
  }
  return "偏防守";
}

function describeSignalTilt(scoreRaw: unknown): string {
  const score = toFiniteNumber(scoreRaw);
  if (score === null) {
    return "方向待确认";
  }
  if (score >= 75) {
    return "偏强";
  }
  if (score >= 60) {
    return "偏积极";
  }
  if (score >= 45) {
    return "偏中性";
  }
  if (score >= 30) {
    return "偏谨慎";
  }
  return "偏弱";
}

function toReadableList(input: unknown, formatter: (item: unknown) => string): string[] {
  const items = Array.isArray(input) ? input : [];
  return Array.from(new Set(
    items
      .map((item) => formatter(item))
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => item !== "-")
  ));
}

function normalizeText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim();
}

function toFiniteNumber(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}
