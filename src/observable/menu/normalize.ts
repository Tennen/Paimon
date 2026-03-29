import { randomUUID } from "crypto";
import {
  MAX_ROOT_BUTTONS,
  MAX_SUB_BUTTONS
} from "./constants";
import {
  ObservableMenuButton,
  ObservableMenuConfig,
  ObservableMenuEventRecord,
  ObservableMenuLeafButton
} from "./types";

export function normalizeObservableMenuConfigInput(
  input: unknown,
  current: ObservableMenuConfig
): ObservableMenuConfig {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawButtons = Array.isArray(source.buttons) ? source.buttons : [];
  if (rawButtons.length > MAX_ROOT_BUTTONS) {
    throw new Error(`一级菜单最多只能配置 ${MAX_ROOT_BUTTONS} 个`);
  }

  const buttons = rawButtons.map((item, index) => normalizeObservableMenuButton(item, index));
  const now = new Date().toISOString();
  return {
    version: 1,
    buttons,
    updatedAt: now,
    ...(current.lastPublishedAt ? { lastPublishedAt: current.lastPublishedAt } : {})
  };
}

export function normalizeStoredObservableMenuConfig(input: unknown): ObservableMenuConfig {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawButtons = Array.isArray(source.buttons) ? source.buttons.slice(0, MAX_ROOT_BUTTONS) : [];
  const buttons = rawButtons.map((item, index) => normalizeObservableMenuButton(item, index));
  const lastPublishedAt = normalizeIsoString(source.lastPublishedAt);
  return {
    version: 1,
    buttons,
    updatedAt: normalizeIsoString(source.updatedAt) || "",
    ...(lastPublishedAt ? { lastPublishedAt } : {})
  };
}

export function normalizeObservableMenuEventRecord(input: unknown): ObservableMenuEventRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input as Record<string, unknown>;
  const status = normalizeEventStatus(source.status);
  if (!status) {
    return null;
  }

  return {
    id: normalizeText(source.id),
    source: "wecom",
    eventType: "click",
    eventKey: normalizeEventKey(source.eventKey),
    fromUser: normalizeText(source.fromUser),
    toUser: normalizeText(source.toUser),
    ...(normalizeText(source.agentId) ? { agentId: normalizeText(source.agentId) } : {}),
    ...(normalizeText(source.matchedButtonId) ? { matchedButtonId: normalizeText(source.matchedButtonId) } : {}),
    ...(normalizeText(source.matchedButtonName) ? { matchedButtonName: normalizeText(source.matchedButtonName) } : {}),
    ...(normalizeText(source.dispatchText) ? { dispatchText: normalizeText(source.dispatchText) } : {}),
    status,
    ...(normalizeText(source.error) ? { error: normalizeText(source.error) } : {}),
    receivedAt: normalizeIsoString(source.receivedAt) || new Date().toISOString()
  };
}

export function findEnabledButtonByKey(config: ObservableMenuConfig, key: string): ObservableMenuLeafButton | null {
  const normalizedKey = normalizeEventKey(key);
  if (!normalizedKey) {
    return null;
  }

  for (const button of config.buttons) {
    if (!button.enabled) {
      continue;
    }

    const enabledSubButtons = button.subButtons.filter((item) => item.enabled);
    if (enabledSubButtons.length > 0) {
      const matched = enabledSubButtons.find((item) => item.key === normalizedKey);
      if (matched) {
        return matched;
      }
      continue;
    }

    if (button.key === normalizedKey) {
      return button;
    }
  }

  return null;
}

export function validateLeafButton(
  button: ObservableMenuLeafButton,
  errors: string[],
  enabledKeys: Map<string, string>,
  label: string
): void {
  if (!button.name) {
    errors.push(`${label} 缺少名称`);
  }
  if (!button.key) {
    errors.push(`${label} 缺少 EventKey`);
    return;
  }

  const owner = enabledKeys.get(button.key);
  if (owner) {
    errors.push(`${label} 的 EventKey 与 ${owner} 重复：${button.key}`);
    return;
  }
  enabledKeys.set(button.key, label);
}

export function normalizeButtonId(raw: unknown, fallback: string): string {
  const normalized = normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function normalizeEventKey(raw: unknown): string {
  return normalizeText(raw).slice(0, 128);
}

export function normalizeText(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

export function normalizeIsoString(raw: unknown): string {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return "";
  }
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

export function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  return fallback;
}

export function buildEventId(): string {
  try {
    return randomUUID();
  } catch {
    return `menu-event-${Date.now()}`;
  }
}

function normalizeObservableMenuButton(input: unknown, index: number): ObservableMenuButton {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawSubButtons = Array.isArray(source.subButtons) ? source.subButtons : [];
  if (rawSubButtons.length > MAX_SUB_BUTTONS) {
    throw new Error(`一级菜单 ${index + 1} 最多只能配置 ${MAX_SUB_BUTTONS} 个二级菜单`);
  }

  return {
    id: normalizeButtonId(source.id, `root-${index + 1}`),
    name: normalizeText(source.name),
    key: normalizeEventKey(source.key),
    enabled: normalizeBoolean(source.enabled, true),
    dispatchText: normalizeText(source.dispatchText),
    subButtons: rawSubButtons.map((item, subIndex) => normalizeObservableMenuLeafButton(item, `root-${index + 1}-sub-${subIndex + 1}`))
  };
}

function normalizeObservableMenuLeafButton(input: unknown, fallbackId: string): ObservableMenuLeafButton {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    id: normalizeButtonId(source.id, fallbackId),
    name: normalizeText(source.name),
    key: normalizeEventKey(source.key),
    enabled: normalizeBoolean(source.enabled, true),
    dispatchText: normalizeText(source.dispatchText)
  };
}

function normalizeEventStatus(raw: unknown): ObservableMenuEventRecord["status"] | null {
  const value = normalizeText(raw).toLowerCase();
  if (value === "recorded" || value === "dispatched" || value === "ignored" || value === "failed") {
    return value;
  }
  return null;
}
