// @ts-nocheck
import { normalizeAssetName, normalizeCode, round, toNumber } from "./utils";

export function parseCommand(input) {
  const raw = String(input || "").trim();
  const fromSlash = /^\/market\b/i.test(raw);
  const body = fromSlash ? raw.replace(/^\/market\b/i, "").trim() : raw;
  const lower = body.toLowerCase();

  if (!body) {
    return { kind: "help" };
  }

  if (["help", "h", "?", "帮助"].includes(lower)) {
    return { kind: "help" };
  }

  if (/^(status|latest|最近|状态)$/i.test(body)) {
    return { kind: "status" };
  }

  if (/^(portfolio|holdings|position|持仓)$/i.test(body)) {
    return { kind: "portfolio" };
  }

  const addPayload = extractPortfolioAddPayload(body);
  if (addPayload) {
    return {
      kind: "portfolio_add",
      holding: parsePortfolioHoldingPayload(addPayload)
    };
  }

  const explicitPhase = detectPhaseFromText(body);
  if (explicitPhase) {
    return {
      kind: "run",
      phase: explicitPhase
    };
  }

  if (/^run\b/i.test(lower)) {
    const rest = body.replace(/^run\b/i, "").trim();
    return {
      kind: "run",
      phase: detectPhaseFromText(rest) || inferPhaseFromLocalTime()
    };
  }

  if (!fromSlash) {
    return {
      kind: "run",
      phase: inferPhaseFromLocalTime()
    };
  }

  return {
    kind: "run",
    phase: inferPhaseFromLocalTime()
  };
}

function extractPortfolioAddPayload(body) {
  const matched = String(body || "").match(
    /^(?:(?:portfolio|holdings|position|持仓)\s+)?(?:add|new|append|create|新增|添加)\s+(.+)$/i
  );
  if (!matched || !matched[1]) {
    return "";
  }
  return matched[1].trim();
}

function parsePortfolioHoldingPayload(payload) {
  const tokens = String(payload || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (tokens.length < 3) {
    throw new Error("添加持仓参数不足。示例: /market add 510300 100 4.12 沪深300ETF");
  }

  const code = normalizeCode(tokens[0]);
  const quantity = toNumber(tokens[1]);
  const avgCost = toNumber(tokens[2]);
  const name = normalizeAssetName(tokens.slice(3).join(" "));

  if (!code) {
    throw new Error("持仓代码无效。示例: /market add 510300 100 4.12 沪深300ETF");
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("持仓数量必须是大于 0 的数字。示例: /market add 510300 100 4.12");
  }

  if (!Number.isFinite(avgCost) || avgCost < 0) {
    throw new Error("持仓成本必须是大于等于 0 的数字。示例: /market add 510300 100 4.12");
  }

  return {
    code,
    name,
    quantity: round(quantity, 4),
    avgCost: round(avgCost, 4)
  };
}

function detectPhaseFromText(text) {
  const source = String(text || "").trim().toLowerCase();
  if (!source) return null;

  if (
    source.includes("midday") ||
    source.includes("盘中") ||
    source.includes("午盘") ||
    source.includes("13:30")
  ) {
    return "midday";
  }

  if (
    source.includes("close") ||
    source.includes("收盘") ||
    source.includes("盘后") ||
    source.includes("15:15")
  ) {
    return "close";
  }

  return null;
}
function inferPhaseFromLocalTime() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (hour > 15 || (hour === 15 && minute >= 15)) {
    return "close";
  }

  return "midday";
}
