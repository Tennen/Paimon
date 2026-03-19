// @ts-nocheck
import {
  DEFAULT_INDEX_CODES,
  DEFAULT_TIMEOUT_MS,
  HISTORY_LIMIT,
  SH_INDEX_CODES,
  SZ_INDEX_CODES
} from "../defaults";
import {
  fetchJson,
  normalizeCode,
  normalizePercent,
  normalizePrice,
  normalizeVolume,
  round,
  toNumber
} from "../utils";

export async function fetchMarketData(input) {
  const indexCodes = Array.isArray(input.indexCodes) ? input.indexCodes : [];
  const assetCodes = Array.isArray(input.assetCodes) ? input.assetCodes : [];

  const indices = {};
  const assets = {};
  const raw = {
    indices: {},
    assets: {}
  };

  await Promise.all(
    indexCodes.map(async (code) => {
      try {
        const snapshot = await fetchSecuritySnapshot(code, "index");
        indices[code] = snapshot.normalized;
        raw.indices[code] = snapshot.raw;
      } catch (error) {
        raw.indices[code] = {
          error: (error && error.message) ? error.message : String(error || "unknown error")
        };
      }
    })
  );

  await Promise.all(
    assetCodes.map(async (code) => {
      try {
        const snapshot = await fetchSecuritySnapshot(code, "asset");
        assets[code] = snapshot.normalized;
        raw.assets[code] = snapshot.raw;
      } catch (error) {
        raw.assets[code] = {
          error: (error && error.message) ? error.message : String(error || "unknown error")
        };
      }
    })
  );

  return {
    fetchedAt: new Date().toISOString(),
    indices,
    assets,
    raw
  };
}

export function resolveIndexCodes() {
  const envCodes = String(process.env.MARKET_ANALYSIS_INDEX_CODES || "").trim();
  const rawCodes = envCodes ? envCodes.split(",") : DEFAULT_INDEX_CODES;

  const normalized = [];
  for (const raw of rawCodes) {
    const code = normalizeCode(raw);
    if (!code) continue;
    if (!normalized.includes(code)) {
      normalized.push(code);
    }
  }

  return normalized.length > 0 ? normalized : DEFAULT_INDEX_CODES.slice();
}

export function chooseBenchmarkCode(indicesMetrics) {
  const available = Object.keys(indicesMetrics || {});
  if (available.length === 0) {
    return "";
  }

  if (available.includes("000300")) {
    return "000300";
  }

  if (available.includes("000001")) {
    return "000001";
  }

  return available.sort()[0];
}

async function fetchSecuritySnapshot(code, kind) {
  const secid = toSecId(code, kind);
  if (!secid) {
    throw new Error(`Unable to infer secid for code: ${code}`);
  }

  const [quotePayload, historyPayload] = await Promise.all([
    fetchQuote(secid),
    fetchHistory(secid)
  ]);

  const normalized = normalizeSecurityData(code, quotePayload, historyPayload);

  if (!Number.isFinite(normalized.prevClose) || normalized.prevClose <= 0) {
    if (normalized.history.length >= 2) {
      normalized.prevClose = normalized.history[normalized.history.length - 2];
    } else {
      normalized.prevClose = normalized.price;
    }
  }

  if (!Number.isFinite(normalized.price) || normalized.price <= 0) {
    if (normalized.history.length > 0) {
      normalized.price = normalized.history[normalized.history.length - 1];
    } else {
      normalized.price = normalized.prevClose;
    }
  }

  const latestHistoryPrice = normalized.history.length > 0
    ? normalized.history[normalized.history.length - 1]
    : NaN;

  if (
    Number.isFinite(normalized.price) &&
    normalized.price > 0 &&
    (!Number.isFinite(latestHistoryPrice) || Math.abs(latestHistoryPrice - normalized.price) > 0.0001)
  ) {
    normalized.history = normalized.history.concat([normalized.price]).slice(-HISTORY_LIMIT);
  }

  const hasValidPrice = Number.isFinite(normalized.price) && normalized.price > 0;
  if (!hasValidPrice && normalized.history.length === 0) {
    throw new Error(`no usable market data for code ${code}`);
  }

  return {
    normalized,
    raw: {
      secid,
      quote: compactQuotePayload(quotePayload),
      history: compactHistoryPayload(historyPayload)
    }
  };
}

async function fetchQuote(secid) {
  const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("fields", "f57,f58,f43,f60,f47,f170,f169");
  return fetchJson(url.toString(), DEFAULT_TIMEOUT_MS);
}

async function fetchHistory(secid) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("lmt", String(HISTORY_LIMIT));
  url.searchParams.set("end", "20500101");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
  return fetchJson(url.toString(), DEFAULT_TIMEOUT_MS);
}

function normalizeSecurityData(code, quotePayload, historyPayload) {
  const quote = (quotePayload && quotePayload.data && typeof quotePayload.data === "object")
    ? quotePayload.data
    : {};

  const klines = historyPayload && historyPayload.data && Array.isArray(historyPayload.data.klines)
    ? historyPayload.data.klines
    : [];

  const history = [];
  const volumeHistory = [];

  for (const item of klines) {
    if (typeof item !== "string") {
      continue;
    }

    const parts = item.split(",");
    if (parts.length < 6) {
      continue;
    }

    const close = toNumber(parts[2]);
    const volume = toNumber(parts[5]);

    if (Number.isFinite(close) && close > 0) {
      history.push(round(close, 4));
    }
    if (Number.isFinite(volume) && volume >= 0) {
      volumeHistory.push(round(volume, 4));
    }
  }

  return {
    code,
    name: typeof quote.f58 === "string" ? quote.f58 : "",
    price: normalizePrice(quote.f43),
    prevClose: normalizePrice(quote.f60),
    volume: normalizeVolume(quote.f47),
    history,
    volumeHistory: volumeHistory.slice(-HISTORY_LIMIT)
  };
}

function compactQuotePayload(payload) {
  const data = payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : {};

  return {
    code: String(data.f57 || ""),
    name: String(data.f58 || ""),
    price: normalizePrice(data.f43),
    prevClose: normalizePrice(data.f60),
    volume: normalizeVolume(data.f47),
    pctChange: normalizePercent(data.f170)
  };
}

function compactHistoryPayload(payload) {
  const data = payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : {};
  const klines = Array.isArray(data.klines) ? data.klines : [];

  const points = klines.slice(-30).map((item) => {
    if (typeof item !== "string") {
      return null;
    }
    const parts = item.split(",");
    if (parts.length < 6) {
      return null;
    }
    return {
      date: parts[0],
      close: toNumber(parts[2]),
      volume: toNumber(parts[5])
    };
  }).filter(Boolean);

  return {
    points
  };
}

function toSecId(code, kind) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return "";
  }

  if (kind === "index") {
    if (SH_INDEX_CODES.has(normalized)) {
      return `1.${normalized}`;
    }
    if (SZ_INDEX_CODES.has(normalized)) {
      return `0.${normalized}`;
    }
  }

  if (normalized.startsWith("6") || normalized.startsWith("5") || normalized.startsWith("9")) {
    return `1.${normalized}`;
  }

  return `0.${normalized}`;
}
