import { SchedulerService } from "../../../scheduler/schedulerService";
import { ScheduledTask } from "../../../scheduler/taskStore";
import { parseOptionalBoolean } from "../utils";
import { normalizeLimit } from "../utils";
import { normalizeDailyTime, parseMarketCodeList, parseMarketPhase } from "./common";
import { normalizeMarketAnalysisConfig, normalizeMarketPortfolio } from "./store";
import {
  BootstrapMarketTasksPayload,
  ImportMarketPortfolioCodesPayload,
  MARKET_PORTFOLIO_IMPORT_MAX_CODES,
  MarketAnalysisConfig,
  MarketPortfolio,
  RunMarketOncePayloadParseResult
} from "./types";

export function parseMarketPortfolioInput(rawBody: unknown): MarketPortfolio | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  const payload = "portfolio" in body ? body.portfolio : rawBody;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return normalizeMarketPortfolio(payload);
}

export function parseImportMarketPortfolioCodesPayload(rawBody: unknown): ImportMarketPortfolioCodesPayload | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  const rawCodes = body.codes;
  let codes: string[] = [];

  if (typeof rawCodes === "string") {
    codes = parseMarketCodeList(rawCodes);
  } else if (Array.isArray(rawCodes)) {
    const joined = rawCodes
      .map((item) => (typeof item === "string" ? item : ""))
      .join(" ");
    codes = parseMarketCodeList(joined);
  } else {
    return null;
  }

  if (codes.length === 0) {
    return null;
  }

  if (codes.length > MARKET_PORTFOLIO_IMPORT_MAX_CODES) {
    codes = codes.slice(0, MARKET_PORTFOLIO_IMPORT_MAX_CODES);
  }

  return { codes };
}

export function parseMarketAnalysisConfigInput(rawBody: unknown): MarketAnalysisConfig | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  const payload = "config" in body ? body.config : rawBody;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return normalizeMarketAnalysisConfig(payload);
}

export function parseBootstrapMarketTasksPayload(rawBody: unknown): BootstrapMarketTasksPayload | null {
  if (!rawBody || typeof rawBody !== "object") {
    return null;
  }

  const body = rawBody as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return null;
  }

  const middayTime = normalizeDailyTime(typeof body.middayTime === "string" ? body.middayTime : "13:30");
  const closeTime = normalizeDailyTime(typeof body.closeTime === "string" ? body.closeTime : "15:15");
  if (!middayTime || !closeTime) {
    return null;
  }

  const enabled = parseOptionalBoolean(body.enabled);
  return {
    userId,
    middayTime,
    closeTime,
    ...(enabled === undefined ? {} : { enabled })
  };
}

export function parseRunMarketOncePayload(rawBody: unknown): RunMarketOncePayloadParseResult {
  if (!rawBody || typeof rawBody !== "object") {
    return { error: "invalid run-once payload" };
  }

  const body = rawBody as Record<string, unknown>;
  const allowedKeys = new Set(["userId", "phase"]);
  const invalidKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (invalidKeys.length > 0) {
    return { error: `unsupported fields: ${invalidKeys.join(", ")}` };
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return { error: "userId is required" };
  }

  const phase = parseMarketPhase(body.phase);
  if (!phase) {
    return { error: "phase must be midday or close" };
  }

  return { payload: { userId, phase } };
}

export function upsertMarketTasks(
  scheduler: SchedulerService,
  payload: BootstrapMarketTasksPayload
): ScheduledTask[] {
  const specs: Array<{ name: string; time: string; message: string; enabled: boolean }> = [
    {
      name: "Market Analysis 盘中",
      time: payload.middayTime ?? "13:30",
      message: "/market midday",
      enabled: payload.enabled ?? true
    },
    {
      name: "Market Analysis 收盘",
      time: payload.closeTime ?? "15:15",
      message: "/market close",
      enabled: payload.enabled ?? true
    }
  ];

  const existing = scheduler.listTasks();
  const upserted: ScheduledTask[] = [];

  for (const spec of specs) {
    const match = existing.find((task) =>
      task.userIds.length === 1 &&
      task.userIds[0] === payload.userId &&
      task.message.trim().toLowerCase() === spec.message
    );

    if (match) {
      const updated = scheduler.updateTask(match.id, {
        name: spec.name,
        enabled: spec.enabled,
        time: spec.time,
        userIds: [payload.userId],
        message: spec.message
      });
      if (!updated) {
        throw new Error(`failed to update market task: ${match.id}`);
      }
      upserted.push(updated);
      continue;
    }

    const created = scheduler.createTask({
      name: spec.name,
      enabled: spec.enabled,
      time: spec.time,
      userIds: [payload.userId],
      message: spec.message
    });
    upserted.push(created);
  }

  return upserted;
}

export function normalizeMarketRouteLimit(raw: unknown, fallback: number, min: number, max: number): number {
  return normalizeLimit(raw, fallback, min, max);
}
