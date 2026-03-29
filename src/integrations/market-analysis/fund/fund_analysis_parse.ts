import type { FundRawContext } from "./fund_types";
import { normalizeDateString, timestampToDate } from "./fund_analysis_normalize";
import {
  dedupStrings,
  escapeRegExp,
  normalizePositiveNumber,
  normalizeSignedNumber,
  normalizeOptionalText,
  parseJsonLoose,
  round
} from "./fund_analysis_utils";

export function parseFundEstimateScript(script: string): Record<string, unknown> {
  const matched = script.match(/jsonpgz\s*\(\s*(\{[\s\S]*\})\s*\)\s*;?/);
  if (!matched?.[1]) {
    return {};
  }
  const parsed = parseJsonLoose(matched[1]);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

export function extractApidataContent(payload: string): string {
  const matched = payload.match(/content\s*:\s*"([\s\S]*?)"\s*,\s*(?:records|arryear|curyear)\s*:/);
  if (!matched?.[1]) {
    return "";
  }
  return matched[1]
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\//g, "/")
    .replace(/\\r\\n|\\n|\\r/g, "");
}

export function extractApidataNumberField(payload: string, field: string): number {
  const pattern = new RegExp(`${escapeRegExp(field)}\\s*:\\s*(\\d+)`);
  const matched = payload.match(pattern);
  return matched?.[1] ? Number(matched[1]) : NaN;
}

export type FundHistoryRow = {
  date: string;
  unit_nav?: number;
  cumulative_nav?: number;
  daily_growth?: number;
  purchase_status: string;
  redemption_status: string;
  dividend: string;
};

export function parseFundHistoryRows(content: string): FundHistoryRow[] {
  const rows = extractHtmlTableRows(content);
  return rows
    .map((row): FundHistoryRow | null => {
      const cells = extractTableCellTexts(row);
      if (cells.length < 3) {
        return null;
      }
      const date = normalizeDateString(cells[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return null;
      }
      return {
        date,
        unit_nav: normalizePositiveNumber(cells[1]),
        cumulative_nav: normalizePositiveNumber(cells[2]),
        daily_growth: normalizeSignedNumber(cells[3]),
        purchase_status: normalizeOptionalText(cells[4]),
        redemption_status: normalizeOptionalText(cells[5]),
        dividend: normalizeOptionalText(cells[6])
      };
    })
    .filter((item): item is FundHistoryRow => Boolean(item));
}

export function parseFundHoldings(content: string): string[] {
  const table = content.match(/<table[\s\S]*?<\/table>/i)?.[0] || "";
  if (!table) {
    return [];
  }

  const rows = extractHtmlTableRows(table);
  const holdings: string[] = [];

  for (const row of rows) {
    const cells = extractTableCellTexts(row);
    if (cells.length < 2) {
      continue;
    }
    const weight = cells.find((item) => /\d+(?:\.\d+)?%/.test(item)) || "";
    const name = cells.find((item) => isFundHoldingName(item)) || "";
    if (!name) {
      continue;
    }
    holdings.push(weight ? `${name}(${weight})` : name);
  }

  return dedupStrings(holdings).slice(0, 10);
}

export function buildHistoryDerivedEvents(rows: FundHistoryRow[]): {
  notices: string[];
  subscription_redemption: string[];
} {
  const sorted = dedupFundHistoryRows(rows)
    .slice()
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, 12);

  const notices = sorted
    .filter((row) => Boolean(row.dividend) && !isHistoryEmptyField(row.dividend))
    .map((row) => `${row.date} ${row.dividend}`);

  const subscriptionRedemption = sorted.flatMap((row) => {
    const items: string[] = [];
    if (isRestrictionStatus(row.purchase_status)) {
      items.push(`${row.date} 申购状态: ${row.purchase_status}`);
    }
    if (isRestrictionStatus(row.redemption_status)) {
      items.push(`${row.date} 赎回状态: ${row.redemption_status}`);
    }
    return items;
  });

  return {
    notices: dedupStrings(notices),
    subscription_redemption: dedupStrings(subscriptionRedemption)
  };
}

export function dedupFundHistoryRows(rows: FundHistoryRow[]): FundHistoryRow[] {
  const map = new Map<string, FundHistoryRow>();
  for (const row of rows) {
    if (!row.date) {
      continue;
    }
    map.set(row.date, row);
  }
  return Array.from(map.values())
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

export function mergeFundSeriesPoints(
  groups: Array<FundRawContext["price_or_nav_series"]>,
  limit: number
): FundRawContext["price_or_nav_series"] {
  const merged = new Map<string, FundRawContext["price_or_nav_series"][number]>();
  for (const group of groups) {
    for (const point of group) {
      const value = normalizePositiveNumber(point?.value);
      if (!point?.date || !Number.isFinite(value) || value <= 0) {
        continue;
      }
      merged.set(normalizeDateString(point.date), {
        date: normalizeDateString(point.date),
        value: round(value, 6)
      });
    }
  }
  return Array.from(merged.values())
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date))
    .slice(-Math.max(1, limit));
}

export function appendEstimatedPoint(
  points: FundRawContext["price_or_nav_series"],
  estimate?: FundRawContext["price_or_nav_series"][number]
): FundRawContext["price_or_nav_series"] {
  if (!estimate?.date) {
    return points.slice();
  }
  const estimateValue = normalizePositiveNumber(estimate.value);
  if (!Number.isFinite(estimateValue) || estimateValue <= 0) {
    return points.slice();
  }

  const normalizedDate = normalizeDateString(estimate.date);
  const existsSameDate = points.some((item) => normalizeDateString(item.date) === normalizedDate);
  if (existsSameDate) {
    return points.slice();
  }

  return [...points, { date: normalizedDate, value: round(estimateValue, 6) }]
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

export function parseFundPeerPercentile(script: string): number {
  const source = parseScriptVariable(script, "Data_rateInSimilarPersent");
  if (!Array.isArray(source) || source.length === 0) {
    return NaN;
  }

  const last = source[source.length - 1];
  if (Array.isArray(last)) {
    return normalizeSignedNumber(last[1]);
  }
  if (last && typeof last === "object") {
    const row = last as Record<string, unknown>;
    return normalizeSignedNumber(row.y ?? row.value);
  }
  return NaN;
}

export function parseFundPeerPercentileSeries(script: string): FundRawContext["price_or_nav_series"] {
  const source = parseScriptVariable(script, "Data_rateInSimilarPersent");
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        const timestamp = Number(item[0]);
        const percentile = normalizePositiveNumber(item[1]);
        if (!Number.isFinite(timestamp) || !Number.isFinite(percentile)) {
          return null;
        }
        return {
          date: timestampToDate(timestamp),
          value: round(percentile, 4)
        };
      }

      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const timestamp = Number(row.x ?? row.date);
        const percentile = normalizePositiveNumber(row.y ?? row.value);
        if (!Number.isFinite(timestamp) || !Number.isFinite(percentile)) {
          return null;
        }
        return {
          date: timestampToDate(timestamp),
          value: round(percentile, 4)
        };
      }

      return null;
    })
    .filter((item): item is { date: string; value: number } => Boolean(item));
}

export function parseFundPeerRankSnapshot(script: string): { position: number; total: number } {
  const source = parseScriptVariable(script, "Data_rateInSimilarType");
  if (!Array.isArray(source) || source.length === 0) {
    return { position: NaN, total: NaN };
  }

  const last = source[source.length - 1];
  if (!last || typeof last !== "object" || Array.isArray(last)) {
    return { position: NaN, total: NaN };
  }

  const row = last as Record<string, unknown>;
  return {
    position: normalizePositiveNumber(row.y),
    total: normalizePositiveNumber(row.sc)
  };
}

export function parseCurrentFundManagers(script: string): string[] {
  const source = parseScriptVariable(script, "Data_currentFundManager");
  if (!Array.isArray(source)) {
    return [];
  }
  return dedupStrings(
    source
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const row = item as Record<string, unknown>;
        return typeof row.name === "string" ? row.name.trim() : "";
      })
      .filter(Boolean)
  );
}

export function parseOtcSeriesFromScript(script: string): FundRawContext["price_or_nav_series"] {
  const netWorth = parseScriptVariable(script, "Data_netWorthTrend");
  if (Array.isArray(netWorth) && netWorth.length > 0) {
    const points = netWorth
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as Record<string, unknown>;
        const timestamp = Number(row.x);
        const value = Number(row.y);
        if (!Number.isFinite(timestamp) || !Number.isFinite(value) || value <= 0) {
          return null;
        }
        return {
          date: timestampToDate(timestamp),
          value: round(value, 6)
        };
      })
      .filter((item): item is { date: string; value: number } => Boolean(item));

    if (points.length > 0) {
      return points;
    }
  }

  const acWorth = parseScriptVariable(script, "Data_ACWorthTrend");
  if (!Array.isArray(acWorth) || acWorth.length === 0) {
    return [];
  }

  return acWorth
    .map((item) => {
      if (!Array.isArray(item) || item.length < 2) {
        return null;
      }

      const timestamp = Number(item[0]);
      const value = Number(item[1]);
      if (!Number.isFinite(timestamp) || !Number.isFinite(value) || value <= 0) {
        return null;
      }

      return {
        date: timestampToDate(timestamp),
        value: round(value, 6)
      };
    })
    .filter((item): item is { date: string; value: number } => Boolean(item));
}

function extractHtmlTableRows(content: string): string[] {
  const matched = content.match(/<tr[\s\S]*?<\/tr>/gi);
  return Array.isArray(matched) ? matched : [];
}

function extractTableCellTexts(rowHtml: string): string[] {
  const matched = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
  if (!Array.isArray(matched)) {
    return [];
  }
  return matched
    .map((item) => normalizeOptionalText(stripHtmlTags(item)))
    .filter(Boolean);
}

function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(String(input || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function isFundHoldingName(value: string): boolean {
  const text = normalizeOptionalText(value);
  if (!text) {
    return false;
  }
  if (/^\d+$/.test(text) || /^\d+(?:\.\d+)?%$/.test(text)) {
    return false;
  }
  if (/^(序号|股票代码|债券代码|股票名称|债券名称|占净值|持仓市值|相关资讯)$/i.test(text)) {
    return false;
  }
  return /[\u4e00-\u9fa5a-z]/i.test(text);
}

function isRestrictionStatus(value: string): boolean {
  const text = normalizeOptionalText(value);
  if (!text) {
    return false;
  }
  return /暂停|限制|限购|限赎|封闭|closed|停售/i.test(text);
}

function isHistoryEmptyField(value: string): boolean {
  const text = normalizeOptionalText(value);
  return !text || /^(--|---|暂无数据|不分红|开放申购|开放赎回)$/i.test(text);
}

function parseScriptVariable(script: string, variableName: string): unknown {
  const pattern = new RegExp(`var\\s+${escapeRegExp(variableName)}\\s*=\\s*([\\s\\S]*?);`);
  const matched = script.match(pattern);
  if (!matched || !matched[1]) {
    return null;
  }

  const raw = matched[1].trim();
  if (!raw) {
    return null;
  }

  return parseJsonLoose(raw);
}
