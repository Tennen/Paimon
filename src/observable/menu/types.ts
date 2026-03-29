import { WeComMenuClient, WeComMenuPublishPayload } from "../../integrations/wecom/menuClient";

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

export type ObservableMenuConfigStore = {
  version: 1;
  config: ObservableMenuConfig;
};

export type ObservableMenuEventLogStore = {
  version: 1;
  updatedAt: string;
  events: ObservableMenuEventRecord[];
};
