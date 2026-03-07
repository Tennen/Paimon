// @ts-nocheck

export async function fetchJson(url, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      ...(init || {}),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeCode(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 6) {
    return digits.slice(-6);
  }
  return digits.padStart(6, "0");
}

export function normalizeAssetName(raw) {
  if (raw === null || raw === undefined) {
    return "";
  }
  return String(raw).trim();
}

export function movingAverage(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }
  const slice = values.slice(-period);
  return round(average(slice), 4);
}

export function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  for (const item of values) {
    const value = toNumber(item);
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  return sum / count;
}

export function normalizePrice(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }

  if (Math.abs(numeric) >= 1000000) {
    return round(numeric / 10000, 4);
  }

  if (Math.abs(numeric) >= 1000) {
    return round(numeric / 100, 4);
  }

  return round(numeric, 4);
}

export function normalizePercent(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }

  if (Math.abs(numeric) >= 1000) {
    return round(numeric / 100, 4);
  }

  return round(numeric, 4);
}

export function normalizeVolume(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, round(numeric, 4));
}

export function parsePositiveInteger(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function toNumber(input) {
  if (typeof input === "number") {
    return input;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return NaN;
    return Number(trimmed);
  }

  return Number(input);
}

export function safeNumber(input) {
  const value = toNumber(input);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

export function round(value, digits) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatNumber(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return String(round(numeric, 4));
}

export function phaseLabel(phase) {
  if (phase === "close") {
    return "收盘";
  }
  return "盘中";
}
