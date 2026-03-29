import type { FundRawContext } from "./fund_types";
import {
  DEFAULT_COMPARISON_REFERENCE,
  buildEmptyHoldingsStyle,
  buildEmptyReferenceContext
} from "./fund_analysis_defaults";
import {
  appendEstimatedPoint,
  buildHistoryDerivedEvents,
  dedupFundHistoryRows,
  extractApidataContent,
  extractApidataNumberField,
  mergeFundSeriesPoints,
  parseCurrentFundManagers,
  parseFundEstimateScript,
  parseFundHistoryRows,
  parseFundHoldings,
  parseFundPeerPercentile,
  parseFundPeerPercentileSeries,
  parseFundPeerRankSnapshot,
  parseOtcSeriesFromScript,
  type FundHistoryRow
} from "./fund_analysis_parse";
import {
  extractTimeString,
  normalizeDateString,
  normalizeDateTimeString
} from "./fund_analysis_normalize";
import {
  dedupStrings,
  fetchTextWithTimeout,
  normalizePositiveNumber,
  normalizeSignedNumber,
  round,
  toStringArray
} from "./fund_analysis_utils";

export type FundBaseDataResult = {
  series: FundRawContext["price_or_nav_series"];
  holdings_style: FundRawContext["holdings_style"];
  reference_context: FundRawContext["reference_context"];
  events: Pick<FundRawContext["events"], "notices" | "manager_changes" | "subscription_redemption" | "regulatory_risks">;
  source_chain: string[];
  errors: string[];
};

type FundEstimateResponse = {
  point?: FundRawContext["price_or_nav_series"][number];
  reference_context: Partial<FundRawContext["reference_context"]>;
  source_chain: string[];
  errors: string[];
};

type FundHistoryResponse = {
  rows: FundHistoryRow[];
  points: FundRawContext["price_or_nav_series"];
  source_chain: string[];
  errors: string[];
};

type FundHistoryPageResponse = {
  rows: FundHistoryRow[];
  pages: number;
};

type FundHoldingsResponse = {
  holdings_style: FundRawContext["holdings_style"];
  source_chain: string[];
  errors: string[];
};

type FundPingzhongdataResponse = {
  points: FundRawContext["price_or_nav_series"];
  reference_context: Partial<FundRawContext["reference_context"]>;
  source_chain: string[];
  errors: string[];
};

export async function fetchFundBaseData(code: string, lookbackDays: number, timeoutMs: number): Promise<FundBaseDataResult> {
  const [estimateResult, historyResult, holdingsResult, pingzhongdataResult] = await Promise.allSettled([
    fetchFundEstimate(code, timeoutMs),
    fetchFundHistory(code, lookbackDays, timeoutMs),
    fetchFundHoldings(code, timeoutMs),
    fetchFundPingzhongdata(code, timeoutMs)
  ]);

  const estimate = estimateResult.status === "fulfilled"
    ? estimateResult.value
    : {
        reference_context: {},
        source_chain: ["eastmoney:fundgz"],
        errors: [estimateResult.reason instanceof Error ? estimateResult.reason.message : String(estimateResult.reason)]
      } satisfies FundEstimateResponse;

  const history = historyResult.status === "fulfilled"
    ? historyResult.value
    : {
        rows: [],
        points: [],
        source_chain: ["eastmoney:fund_lsjz"],
        errors: [historyResult.reason instanceof Error ? historyResult.reason.message : String(historyResult.reason)]
      } satisfies FundHistoryResponse;

  const holdings = holdingsResult.status === "fulfilled"
    ? holdingsResult.value
    : {
        holdings_style: buildEmptyHoldingsStyle(),
        source_chain: ["eastmoney:fund_jjcc"],
        errors: [holdingsResult.reason instanceof Error ? holdingsResult.reason.message : String(holdingsResult.reason)]
      } satisfies FundHoldingsResponse;

  const pingzhongdata = pingzhongdataResult.status === "fulfilled"
    ? pingzhongdataResult.value
    : {
        points: [],
        reference_context: {},
        source_chain: ["eastmoney:fund_pingzhongdata"],
        errors: [pingzhongdataResult.reason instanceof Error ? pingzhongdataResult.reason.message : String(pingzhongdataResult.reason)]
      } satisfies FundPingzhongdataResponse;

  const targetLength = Math.max(30, lookbackDays + 10);
  const mergedHistory = mergeFundSeriesPoints([
    pingzhongdata.points,
    history.points
  ], targetLength);
  const series = mergedHistory.length > 0
    ? appendEstimatedPoint(mergedHistory, estimate.point).slice(-targetLength)
    : [];
  const historyEvents = buildHistoryDerivedEvents(history.rows);

  return {
    series,
    holdings_style: holdings.holdings_style,
    reference_context: {
      ...buildEmptyReferenceContext(),
      ...pingzhongdata.reference_context,
      ...estimate.reference_context,
      comparison_reference: pingzhongdata.reference_context.comparison_reference || DEFAULT_COMPARISON_REFERENCE,
      current_managers: dedupStrings([
        ...buildEmptyReferenceContext().current_managers,
        ...toStringArray(pingzhongdata.reference_context.current_managers)
      ]),
      peer_percentile_series: mergeFundSeriesPoints([
        buildEmptyReferenceContext().peer_percentile_series,
        Array.isArray(pingzhongdata.reference_context.peer_percentile_series)
          ? pingzhongdata.reference_context.peer_percentile_series
          : []
      ], targetLength)
    },
    events: {
      notices: historyEvents.notices,
      manager_changes: [],
      subscription_redemption: historyEvents.subscription_redemption,
      regulatory_risks: []
    },
    source_chain: dedupStrings([
      ...estimate.source_chain,
      ...history.source_chain,
      ...holdings.source_chain,
      ...pingzhongdata.source_chain
    ]),
    errors: dedupStrings([
      ...history.errors,
      ...pingzhongdata.errors,
      ...(series.length === 0 ? estimate.errors : []),
      ...(holdings.holdings_style.top_holdings.length === 0 && series.length === 0 ? holdings.errors : [])
    ])
  };
}

async function fetchFundEstimate(code: string, timeoutMs: number): Promise<FundEstimateResponse> {
  const url = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`;

  try {
    const script = await fetchTextWithTimeout(url, timeoutMs);
    const payload = parseFundEstimateScript(script);
    const estimateValue = normalizePositiveNumber(payload.gsz);
    const estimatedSource = typeof payload.gztime === "string"
      ? payload.gztime
      : typeof payload.jzrq === "string"
        ? payload.jzrq
        : "";
    const estimatedAt = normalizeDateTimeString(estimatedSource);
    const estimatedDate = normalizeDateString(estimatedAt || estimatedSource);
    const estimatedTime = extractTimeString(estimatedAt);

    return {
      ...(Number.isFinite(estimateValue) && estimateValue > 0
        ? {
            point: {
              date: estimatedDate,
              value: round(estimateValue, 6)
            }
          }
        : {}),
      reference_context: {
        ...(Number.isFinite(estimateValue) && estimateValue > 0 ? { estimated_nav: round(estimateValue, 6) } : {}),
        ...(estimatedDate ? { estimated_nav_date: estimatedDate } : {}),
        ...(estimatedTime ? { estimated_nav_time: estimatedTime } : {}),
        ...(Number.isFinite(normalizeSignedNumber(payload.gszzl))
          ? { estimated_change_pct: round(normalizeSignedNumber(payload.gszzl), 4) }
          : {})
      },
      source_chain: ["eastmoney:fundgz"],
      errors: []
    };
  } catch (error) {
    return {
      reference_context: {},
      source_chain: ["eastmoney:fundgz"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchFundHistory(code: string, lookbackDays: number, timeoutMs: number): Promise<FundHistoryResponse> {
  const per = 49;
  const targetRows = Math.max(30, lookbackDays + 10);

  try {
    const firstPage = await fetchFundHistoryPage(code, 1, per, timeoutMs);
    const pageCount = Math.min(
      Math.max(1, firstPage.pages),
      Math.max(1, Math.ceil(targetRows / per))
    );

    const remainingPages = pageCount > 1
      ? await Promise.allSettled(
        Array.from({ length: pageCount - 1 }, (_, index) => fetchFundHistoryPage(code, index + 2, per, timeoutMs))
      )
      : [];

    const rows = firstPage.rows.slice();
    const errors: string[] = [];

    for (const page of remainingPages) {
      if (page.status === "fulfilled") {
        rows.push(...page.value.rows);
      } else {
        errors.push(page.reason instanceof Error ? page.reason.message : String(page.reason));
      }
    }

    const points = rows
      .map((row) => {
        const unitNav = normalizePositiveNumber(row.unit_nav);
        if (!Number.isFinite(unitNav) || unitNav <= 0) {
          return null;
        }
        return {
          date: row.date,
          value: round(unitNav, 6)
        };
      })
      .filter((item): item is { date: string; value: number } => Boolean(item));

    return {
      rows: dedupFundHistoryRows(rows).slice(-targetRows),
      points: mergeFundSeriesPoints([points], targetRows),
      source_chain: ["eastmoney:fund_lsjz"],
      errors: dedupStrings(errors)
    };
  } catch (error) {
    return {
      rows: [],
      points: [],
      source_chain: ["eastmoney:fund_lsjz"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchFundHistoryPage(
  code: string,
  page: number,
  per: number,
  timeoutMs: number
): Promise<FundHistoryPageResponse> {
  const url = new URL("https://fundf10.eastmoney.com/F10DataApi.aspx");
  url.searchParams.set("type", "lsjz");
  url.searchParams.set("code", code);
  url.searchParams.set("page", String(Math.max(1, page)));
  url.searchParams.set("per", String(Math.max(1, per)));
  url.searchParams.set("sdate", "");
  url.searchParams.set("edate", "");

  const payload = await fetchTextWithTimeout(url.toString(), timeoutMs);
  const content = extractApidataContent(payload);
  const rows = parseFundHistoryRows(content);
  const pages = extractApidataNumberField(payload, "pages");

  return {
    rows,
    pages: Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 1
  };
}

async function fetchFundHoldings(code: string, timeoutMs: number): Promise<FundHoldingsResponse> {
  const url = new URL("https://fundf10.eastmoney.com/FundArchivesDatas.aspx");
  url.searchParams.set("type", "jjcc");
  url.searchParams.set("code", code);
  url.searchParams.set("topline", "10");
  url.searchParams.set("year", "");
  url.searchParams.set("month", "");
  url.searchParams.set("_", String(Date.now()));

  try {
    const payload = await fetchTextWithTimeout(url.toString(), timeoutMs);
    const content = extractApidataContent(payload);
    return {
      holdings_style: {
        ...buildEmptyHoldingsStyle(),
        top_holdings: parseFundHoldings(content)
      },
      source_chain: ["eastmoney:fund_jjcc"],
      errors: []
    };
  } catch (error) {
    return {
      holdings_style: buildEmptyHoldingsStyle(),
      source_chain: ["eastmoney:fund_jjcc"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function fetchFundPingzhongdata(code: string, timeoutMs: number): Promise<FundPingzhongdataResponse> {
  const url = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`;

  try {
    const script = await fetchTextWithTimeout(url, timeoutMs);
    const peerPercentile = parseFundPeerPercentile(script);
    const peerPercentileSeries = parseFundPeerPercentileSeries(script);
    const peerRankSnapshot = parseFundPeerRankSnapshot(script);
    return {
      points: parseOtcSeriesFromScript(script),
      reference_context: {
        comparison_reference: DEFAULT_COMPARISON_REFERENCE,
        ...(Number.isFinite(peerPercentile) ? { peer_percentile: round(peerPercentile, 4) } : {}),
        ...(Number.isFinite(peerRankSnapshot.position) ? { peer_rank_position: round(peerRankSnapshot.position, 0) } : {}),
        ...(Number.isFinite(peerRankSnapshot.total) ? { peer_rank_total: round(peerRankSnapshot.total, 0) } : {}),
        peer_percentile_series: peerPercentileSeries,
        current_managers: parseCurrentFundManagers(script)
      },
      source_chain: ["eastmoney:fund_pingzhongdata"],
      errors: []
    };
  } catch (error) {
    return {
      points: [],
      reference_context: {},
      source_chain: ["eastmoney:fund_pingzhongdata"],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}
