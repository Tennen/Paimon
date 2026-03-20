import { randomUUID } from "crypto";
import {
  DATA_STORE,
  getStore,
  registerStore,
  setStore
} from "../storage/persistence";
import {
  WeComMenuClient,
  WeComMenuPublishGroupButton,
  WeComMenuPublishLeafButton,
  WeComMenuPublishPayload
} from "../integrations/wecom/menuClient";

const OBSERVABLE_MENU_CONFIG_STORE = DATA_STORE.OBSERVABLE_MENU_CONFIG;
const OBSERVABLE_EVENT_LOG_STORE = DATA_STORE.OBSERVABLE_EVENT_LOG;
const MAX_ROOT_BUTTONS = 3;
const MAX_SUB_BUTTONS = 5;
const MAX_EVENT_LOG_ITEMS = 50;

let observableStoresRegistered = false;

export type ObservableMenuLeafButton = {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  dispatchText: string;
};

export type ObservableMenuButton = ObservableMenuLeafButton & {
  subButtons: ObservableMenuLeafButton[];
};

export type ObservableMenuConfig = {
  version: 1;
  buttons: ObservableMenuButton[];
  updatedAt: string;
  lastPublishedAt?: string;
};

export type ObservableMenuEventRecord = {
  id: string;
  source: "wecom";
  eventType: "click";
  eventKey: string;
  fromUser: string;
  toUser: string;
  agentId?: string;
  matchedButtonId?: string;
  matchedButtonName?: string;
  dispatchText?: string;
  status: "recorded" | "dispatched" | "ignored" | "failed";
  error?: string;
  receivedAt: string;
};

type ObservableMenuConfigStore = {
  version: 1;
  config: ObservableMenuConfig;
};

type ObservableMenuEventLogStore = {
  version: 1;
  updatedAt: string;
  events: ObservableMenuEventRecord[];
};

export type ObservableMenuSnapshot = {
  config: ObservableMenuConfig;
  recentEvents: ObservableMenuEventRecord[];
  publishPayload: WeComMenuPublishPayload | null;
  validationErrors: string[];
};

export type ObservableMenuClickHandleInput = {
  eventKey: string;
  fromUser: string;
  toUser: string;
  agentId?: string;
  receivedAt?: string;
};

export type ObservableMenuClickHandleResult = {
  event: ObservableMenuEventRecord;
  dispatchText: string;
  replyText: string;
};

export type ObservableMenuPublisher = Pick<WeComMenuClient, "createMenu">;

export class ObservableMenuService {
  private readonly menuPublisher: ObservableMenuPublisher;

  constructor(menuPublisher?: ObservableMenuPublisher) {
    this.menuPublisher = menuPublisher ?? new WeComMenuClient();
    ensureObservableStores();
  }

  getSnapshot(): ObservableMenuSnapshot {
    const config = readObservableMenuConfig();
    return buildSnapshot(config, readObservableMenuEvents());
  }

  saveConfig(input: unknown): ObservableMenuSnapshot {
    const current = readObservableMenuConfig();
    const next = normalizeObservableMenuConfigInput(input, current);
    writeObservableMenuConfig(next);
    return buildSnapshot(next, readObservableMenuEvents());
  }

  async publishConfig(input?: unknown): Promise<ObservableMenuSnapshot> {
    const current = readObservableMenuConfig();
    const next = input === undefined
      ? current
      : normalizeObservableMenuConfigInput(input, current);
    const validationErrors = validateObservableMenuConfig(next);
    if (validationErrors.length > 0) {
      throw new Error(validationErrors[0]);
    }

    const publishPayload = buildWeComMenuPublishPayload(next);
    await this.menuPublisher.createMenu(publishPayload);

    const published: ObservableMenuConfig = {
      ...next,
      lastPublishedAt: new Date().toISOString()
    };
    writeObservableMenuConfig(published);
    return buildSnapshot(published, readObservableMenuEvents());
  }

  handleWeComClickEvent(input: ObservableMenuClickHandleInput): ObservableMenuClickHandleResult {
    const receivedAt = normalizeIsoString(input.receivedAt) || new Date().toISOString();
    const eventKey = normalizeEventKey(input.eventKey);
    const fromUser = normalizeText(input.fromUser);
    const toUser = normalizeText(input.toUser);
    const agentId = normalizeText(input.agentId);
    const config = readObservableMenuConfig();
    const matched = findEnabledButtonByKey(config, eventKey);

    const event: ObservableMenuEventRecord = {
      id: buildEventId(),
      source: "wecom",
      eventType: "click",
      eventKey,
      fromUser,
      toUser,
      ...(agentId ? { agentId } : {}),
      status: "ignored",
      receivedAt,
      ...(matched ? {
        matchedButtonId: matched.id,
        matchedButtonName: matched.name
      } : {})
    };

    let dispatchText = "";
    let replyText = "";
    if (!matched) {
      event.status = "ignored";
      replyText = eventKey
        ? `已收到菜单事件：${eventKey}`
        : "已收到菜单事件";
    } else {
      dispatchText = normalizeText(matched.dispatchText);
      if (dispatchText) {
        event.status = "dispatched";
        event.dispatchText = dispatchText;
      } else {
        event.status = "recorded";
        replyText = `已收到菜单事件：${matched.name || matched.key || eventKey}`;
      }
    }

    appendObservableMenuEvent(event);
    return {
      event,
      dispatchText,
      replyText
    };
  }

  markEventDispatchFailed(eventId: string, error: unknown): void {
    const normalizedEventId = normalizeText(eventId);
    if (!normalizedEventId) {
      return;
    }

    const store = readObservableMenuEventStore();
    const nextEvents = store.events.map((item) => {
      if (item.id !== normalizedEventId) {
        return item;
      }
      return {
        ...item,
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error ?? "unknown error")
      };
    });
    writeObservableMenuEventStore({
      ...store,
      updatedAt: new Date().toISOString(),
      events: nextEvents
    });
  }
}

export function validateObservableMenuConfig(config: ObservableMenuConfig): string[] {
  const errors: string[] = [];
  const rootButtons = Array.isArray(config.buttons) ? config.buttons : [];

  if (rootButtons.length > MAX_ROOT_BUTTONS) {
    errors.push(`一级菜单最多只能配置 ${MAX_ROOT_BUTTONS} 个`);
  }

  const enabledKeys = new Map<string, string>();

  rootButtons.forEach((button, index) => {
    if (button.subButtons.length > MAX_SUB_BUTTONS) {
      errors.push(`一级菜单“${button.name || `按钮 ${index + 1}`}”最多只能配置 ${MAX_SUB_BUTTONS} 个二级菜单`);
    }

    if (!button.enabled) {
      return;
    }

    const subButtons = button.subButtons.filter((item) => item.enabled);
    if (subButtons.length > 0) {
      if (!button.name) {
        errors.push(`一级菜单 ${index + 1} 缺少名称`);
      }
      subButtons.forEach((subButton, subIndex) => {
        validateLeafButton(subButton, errors, enabledKeys, `二级菜单 ${index + 1}.${subIndex + 1}`);
      });
      return;
    }

    validateLeafButton(button, errors, enabledKeys, `一级菜单 ${index + 1}`);
  });

  if (enabledKeys.size === 0) {
    errors.push("至少需要 1 个启用的 click 菜单");
  }

  return errors;
}

export function buildWeComMenuPublishPayload(config: ObservableMenuConfig): WeComMenuPublishPayload {
  const validationErrors = validateObservableMenuConfig(config);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors[0]);
  }

  const buttons: Array<WeComMenuPublishLeafButton | WeComMenuPublishGroupButton> = [];

  for (const button of config.buttons) {
    if (!button.enabled) {
      continue;
    }

    const enabledSubButtons = button.subButtons.filter((item) => item.enabled);
    if (enabledSubButtons.length > 0) {
      buttons.push({
        name: button.name,
        sub_button: enabledSubButtons.map((item) => ({
          type: "click",
          name: item.name,
          key: item.key
        }))
      });
      continue;
    }

    buttons.push({
      type: "click",
      name: button.name,
      key: button.key
    });
  }

  return {
    button: buttons
  };
}

function ensureObservableStores(): void {
  if (observableStoresRegistered) {
    return;
  }

  registerStore(OBSERVABLE_MENU_CONFIG_STORE, () => ({
    version: 1,
    config: createDefaultObservableMenuConfig()
  }));
  registerStore(OBSERVABLE_EVENT_LOG_STORE, () => ({
    version: 1,
    updatedAt: "",
    events: []
  }));
  observableStoresRegistered = true;
}

function createDefaultObservableMenuConfig(): ObservableMenuConfig {
  return {
    version: 1,
    buttons: [],
    updatedAt: ""
  };
}

function buildSnapshot(config: ObservableMenuConfig, events: ObservableMenuEventRecord[]): ObservableMenuSnapshot {
  const validationErrors = validateObservableMenuConfig(config);
  return {
    config,
    recentEvents: events.slice(0, MAX_EVENT_LOG_ITEMS),
    publishPayload: validationErrors.length === 0 ? buildWeComMenuPublishPayload(config) : null,
    validationErrors
  };
}

function readObservableMenuConfig(): ObservableMenuConfig {
  ensureObservableStores();
  const raw = getStore<unknown>(OBSERVABLE_MENU_CONFIG_STORE);
  if (!raw || typeof raw !== "object") {
    return createDefaultObservableMenuConfig();
  }

  const source = raw as Partial<ObservableMenuConfigStore>;
  return normalizeStoredObservableMenuConfig(source.config);
}

function writeObservableMenuConfig(config: ObservableMenuConfig): void {
  ensureObservableStores();
  setStore(OBSERVABLE_MENU_CONFIG_STORE, {
    version: 1,
    config
  } satisfies ObservableMenuConfigStore);
}

function readObservableMenuEvents(): ObservableMenuEventRecord[] {
  return readObservableMenuEventStore().events;
}

function readObservableMenuEventStore(): ObservableMenuEventLogStore {
  ensureObservableStores();
  const raw = getStore<unknown>(OBSERVABLE_EVENT_LOG_STORE);
  if (!raw || typeof raw !== "object") {
    return {
      version: 1,
      updatedAt: "",
      events: []
    };
  }

  const source = raw as Record<string, unknown>;
  const rawEvents = Array.isArray(source.events) ? source.events : [];
  const events = rawEvents
    .map((item) => normalizeObservableMenuEventRecord(item))
    .filter((item): item is ObservableMenuEventRecord => Boolean(item));

  return {
    version: 1,
    updatedAt: normalizeIsoString(source.updatedAt) || "",
    events
  };
}

function writeObservableMenuEventStore(store: ObservableMenuEventLogStore): void {
  ensureObservableStores();
  setStore(OBSERVABLE_EVENT_LOG_STORE, store);
}

function appendObservableMenuEvent(event: ObservableMenuEventRecord): void {
  const store = readObservableMenuEventStore();
  const nextEvents = [event, ...store.events].slice(0, MAX_EVENT_LOG_ITEMS);
  writeObservableMenuEventStore({
    version: 1,
    updatedAt: new Date().toISOString(),
    events: nextEvents
  });
}

function normalizeObservableMenuConfigInput(
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

function normalizeStoredObservableMenuConfig(input: unknown): ObservableMenuConfig {
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

function normalizeObservableMenuEventRecord(input: unknown): ObservableMenuEventRecord | null {
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

function normalizeEventStatus(raw: unknown): ObservableMenuEventRecord["status"] | null {
  const value = normalizeText(raw).toLowerCase();
  if (value === "recorded" || value === "dispatched" || value === "ignored" || value === "failed") {
    return value;
  }
  return null;
}

function validateLeafButton(
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

function findEnabledButtonByKey(config: ObservableMenuConfig, key: string): ObservableMenuLeafButton | null {
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

function normalizeButtonId(raw: unknown, fallback: string): string {
  const normalized = normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeEventKey(raw: unknown): string {
  return normalizeText(raw).slice(0, 128);
}

function normalizeText(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function normalizeIsoString(raw: unknown): string {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return "";
  }
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  return fallback;
}

function buildEventId(): string {
  try {
    return randomUUID();
  } catch {
    return `menu-event-${Date.now()}`;
  }
}
