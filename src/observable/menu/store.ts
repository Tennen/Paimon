import {
  getStore,
  registerStore,
  setStore
} from "../../storage/persistence";
import {
  MAX_EVENT_LOG_ITEMS,
  OBSERVABLE_EVENT_LOG_STORE,
  OBSERVABLE_MENU_CONFIG_STORE
} from "./constants";
import {
  normalizeIsoString,
  normalizeObservableMenuEventRecord,
  normalizeStoredObservableMenuConfig
} from "./normalize";
import {
  ObservableMenuConfig,
  ObservableMenuConfigStore,
  ObservableMenuEventLogStore,
  ObservableMenuEventRecord
} from "./types";

let observableStoresRegistered = false;

export function ensureObservableStores(): void {
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

export function createDefaultObservableMenuConfig(): ObservableMenuConfig {
  return {
    version: 1,
    buttons: [],
    updatedAt: ""
  };
}

export function readObservableMenuConfig(): ObservableMenuConfig {
  ensureObservableStores();
  const raw = getStore<unknown>(OBSERVABLE_MENU_CONFIG_STORE);
  if (!raw || typeof raw !== "object") {
    return createDefaultObservableMenuConfig();
  }

  const source = raw as Partial<ObservableMenuConfigStore>;
  return normalizeStoredObservableMenuConfig(source.config);
}

export function writeObservableMenuConfig(config: ObservableMenuConfig): void {
  ensureObservableStores();
  setStore(OBSERVABLE_MENU_CONFIG_STORE, {
    version: 1,
    config
  } satisfies ObservableMenuConfigStore);
}

export function readObservableMenuEvents(): ObservableMenuEventRecord[] {
  return readObservableMenuEventStore().events;
}

export function readObservableMenuEventStore(): ObservableMenuEventLogStore {
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

export function writeObservableMenuEventStore(store: ObservableMenuEventLogStore): void {
  ensureObservableStores();
  setStore(OBSERVABLE_EVENT_LOG_STORE, store);
}

export function appendObservableMenuEvent(event: ObservableMenuEventRecord): void {
  const store = readObservableMenuEventStore();
  const nextEvents = [event, ...store.events].slice(0, MAX_EVENT_LOG_ITEMS);
  writeObservableMenuEventStore({
    version: 1,
    updatedAt: new Date().toISOString(),
    events: nextEvents
  });
}
