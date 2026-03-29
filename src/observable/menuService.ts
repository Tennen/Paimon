import { WeComMenuClient } from "../integrations/wecom/menuClient";
import {
  appendObservableMenuEvent,
  ensureObservableStores,
  readObservableMenuConfig,
  readObservableMenuEvents,
  readObservableMenuEventStore,
  writeObservableMenuConfig,
  writeObservableMenuEventStore
} from "./menu/store";
import {
  buildEventId,
  findEnabledButtonByKey,
  normalizeEventKey,
  normalizeIsoString,
  normalizeObservableMenuConfigInput,
  normalizeText
} from "./menu/normalize";
import {
  buildSnapshot,
  buildWeComMenuPublishPayload,
  validateObservableMenuConfig
} from "./menu/publish";
export type {
  ObservableMenuButton,
  ObservableMenuClickHandleInput,
  ObservableMenuClickHandleResult,
  ObservableMenuConfig,
  ObservableMenuEventRecord,
  ObservableMenuLeafButton,
  ObservableMenuPublisher,
  ObservableMenuSnapshot
} from "./menu/types";
import {
  ObservableMenuClickHandleInput,
  ObservableMenuClickHandleResult,
  ObservableMenuConfig,
  ObservableMenuEventRecord,
  ObservableMenuPublisher,
  ObservableMenuSnapshot
} from "./menu/types";

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
