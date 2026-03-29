import { MARKET_SECURITY_SEARCH_TIMEOUT_MS, EASTMONEY_SEARCH_TOKEN, MarketSecuritySearchItem } from "./types";
import { extractSixDigitCode, getStringField, normalizeMarketCode } from "./common";

export async function resolveMarketSecurityByCode(code: string): Promise<MarketSecuritySearchItem | null> {
  const items = await searchMarketSecurities(code, 12);
  const normalizedCode = normalizeMarketCode(code);
  if (!normalizedCode) {
    return null;
  }

  const exact = items.find((item) => normalizeMarketCode(item.code) === normalizedCode);
  if (exact) {
    return {
      ...exact,
      code: normalizedCode
    };
  }
  return null;
}

export async function searchMarketSecurities(keyword: string, limit: number): Promise<MarketSecuritySearchItem[]> {
  const query = keyword.trim();
  if (!query) {
    return [];
  }

  const endpointCandidates = [
    "https://searchapi.eastmoney.com/api/suggest/get",
    "https://searchadapter.eastmoney.com/api/suggest/get"
  ];

  const requestCount = Math.max(limit * 2, 20);
  const errors: string[] = [];
  let hasSuccessfulResponse = false;

  for (const endpoint of endpointCandidates) {
    const url = new URL(endpoint);
    url.searchParams.set("input", query);
    url.searchParams.set("type", "14");
    url.searchParams.set("count", String(requestCount));
    url.searchParams.set("token", EASTMONEY_SEARCH_TOKEN);
    url.searchParams.set("_", String(Date.now()));

    try {
      const rawText = await fetchTextWithTimeout(url.toString(), MARKET_SECURITY_SEARCH_TIMEOUT_MS);
      const payload = parseJsonOrJsonp(rawText);
      const items = normalizeEastmoneySearchResults(payload, query, limit);
      hasSuccessfulResponse = true;
      if (items.length > 0) {
        return items;
      }
    } catch (error) {
      errors.push((error as Error).message ?? String(error));
    }
  }

  if (hasSuccessfulResponse) {
    return [];
  }

  if (errors.length > 0) {
    throw new Error(`market search provider unavailable: ${errors.join(" | ")}`);
  }

  return [];
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonOrJsonp(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    // no-op
  }

  const firstParen = text.indexOf("(");
  const lastParen = text.lastIndexOf(")");
  if (firstParen <= 0 || lastParen <= firstParen) {
    throw new Error("unexpected search payload");
  }

  const jsonPayload = text.slice(firstParen + 1, lastParen).trim();
  if (!jsonPayload) {
    return {};
  }
  return JSON.parse(jsonPayload);
}

function normalizeEastmoneySearchResults(payload: unknown, keyword: string, limit: number): MarketSecuritySearchItem[] {
  const rows = extractEastmoneySearchRows(payload);
  if (rows.length === 0) {
    return [];
  }

  const query = keyword.trim();
  const queryLower = query.toLowerCase();
  const queryDigits = extractSixDigitCode(query);
  const scored = new Map<string, { item: MarketSecuritySearchItem; score: number }>();

  for (const row of rows) {
    const normalized = normalizeEastmoneySearchRow(row);
    if (!normalized) {
      continue;
    }

    const pinyin = getStringField(row, ["PinYin", "PY", "py", "pinyin"]).toLowerCase();
    const score = calculateSearchScore(normalized, queryLower, queryDigits, pinyin);
    const existing = scored.get(normalized.code);
    if (!existing || score < existing.score) {
      scored.set(normalized.code, {
        item: normalized,
        score
      });
    }
  }

  return Array.from(scored.values())
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.item.code.localeCompare(right.item.code);
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}

function extractEastmoneySearchRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as Record<string, unknown>;
  const table = source.QuotationCodeTable;
  if (table && typeof table === "object") {
    const tableRecord = table as Record<string, unknown>;
    if (Array.isArray(tableRecord.Data)) {
      return tableRecord.Data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
    if (Array.isArray(tableRecord.data)) {
      return tableRecord.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
  }

  if (Array.isArray(source.Data)) {
    return source.Data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (Array.isArray(source.data)) {
    return source.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }

  return [];
}

function normalizeEastmoneySearchRow(row: Record<string, unknown>): MarketSecuritySearchItem | null {
  const code = inferSearchCode(row);
  if (!code) {
    return null;
  }

  const name = getStringField(row, ["Name", "name", "SecurityName", "securityName", "ShortName", "Zqmc"]).trim();
  if (!name) {
    return null;
  }

  const market = inferSearchMarket(row, code);
  const securityType = getStringField(row, ["SecurityTypeName", "securityTypeName", "SecurityType", "Classify", "TypeName"]).trim();
  const rawSecid = getStringField(row, ["QuoteID", "quoteId", "SecID", "secid", "SecurityID", "securityId"]).trim();
  const secid = /^[01]\.\d{6}$/.test(rawSecid)
    ? rawSecid
    : (market ? `${market === "SH" ? "1" : "0"}.${code}` : undefined);

  return {
    code,
    name,
    market,
    securityType,
    ...(secid ? { secid } : {})
  };
}

function inferSearchCode(row: Record<string, unknown>): string {
  const candidates = [
    getStringField(row, ["Code", "code", "SecurityCode", "securityCode", "UnifiedCode", "unifiedCode"]),
    getStringField(row, ["QuoteID", "quoteId", "SecID", "secid"]),
    getStringField(row, ["ID", "id", "InnerCode", "innerCode"])
  ];

  for (const candidate of candidates) {
    const code = extractSixDigitCode(candidate);
    if (code) {
      return code;
    }
  }
  return "";
}

function inferSearchMarket(row: Record<string, unknown>, code: string): string {
  const exchange = getStringField(row, ["JYS", "Exchange", "exchange", "MktAbbr", "mktAbbr"]).trim().toUpperCase();
  if (exchange.includes("SH") || exchange.includes("SSE")) {
    return "SH";
  }
  if (exchange.includes("SZ")) {
    return "SZ";
  }

  const quoteId = getStringField(row, ["QuoteID", "quoteId", "SecID", "secid"]).trim();
  if (/^1\.\d{6}$/.test(quoteId)) {
    return "SH";
  }
  if (/^0\.\d{6}$/.test(quoteId)) {
    return "SZ";
  }

  const marketNum = getStringField(row, ["MktNum", "mktNum", "MarketType", "marketType"]).trim();
  if (marketNum === "1") {
    return "SH";
  }
  if (marketNum === "0") {
    return "SZ";
  }

  if (["5", "6", "9"].includes(code[0])) {
    return "SH";
  }
  if (["0", "1", "2", "3"].includes(code[0])) {
    return "SZ";
  }

  return "";
}

function calculateSearchScore(
  item: MarketSecuritySearchItem,
  queryLower: string,
  queryDigits: string,
  pinyin: string
): number {
  let score = 100;
  const nameLower = item.name.toLowerCase();

  if (queryDigits) {
    if (item.code === queryDigits) {
      score -= 80;
    } else if (item.code.includes(queryDigits)) {
      score -= 35;
    }
  }

  if (queryLower) {
    if (nameLower === queryLower) {
      score -= 70;
    } else if (nameLower.startsWith(queryLower)) {
      score -= 50;
    } else if (nameLower.includes(queryLower)) {
      score -= 30;
    }

    if (pinyin) {
      if (pinyin === queryLower) {
        score -= 25;
      } else if (pinyin.startsWith(queryLower)) {
        score -= 15;
      } else if (pinyin.includes(queryLower)) {
        score -= 8;
      }
    }
  }

  if (item.market === "SH" || item.market === "SZ") {
    score -= 2;
  }

  return score;
}
