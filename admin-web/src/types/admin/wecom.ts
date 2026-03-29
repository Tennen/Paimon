import type { DataStoreDescriptor } from "./common";

export type WeComMenuLeafButton = {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  dispatchText: string;
};

export type WeComMenuButton = WeComMenuLeafButton & {
  subButtons: WeComMenuLeafButton[];
};

export type WeComMenuConfig = {
  version: 1;
  buttons: WeComMenuButton[];
  updatedAt: string;
  lastPublishedAt?: string;
};

export type WeComMenuEventRecord = {
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

export type WeComMenuPublishLeafButton = {
  type: "click";
  name: string;
  key: string;
};

export type WeComMenuPublishGroupButton = {
  name: string;
  sub_button: WeComMenuPublishLeafButton[];
};

export type WeComMenuPublishPayload = {
  button: Array<WeComMenuPublishLeafButton | WeComMenuPublishGroupButton>;
};

export type WeComMenuSnapshot = {
  config: WeComMenuConfig;
  recentEvents: WeComMenuEventRecord[];
  publishPayload: WeComMenuPublishPayload | null;
  validationErrors: string[];
};

export type DirectInputMatchMode = "exact" | "fuzzy";

export type DirectInputMappingRule = {
  id: string;
  name: string;
  pattern: string;
  targetText: string;
  matchMode: DirectInputMatchMode;
  enabled: boolean;
};

export type DirectInputMappingConfig = {
  version: 1;
  rules: DirectInputMappingRule[];
  updatedAt: string;
};

export type DirectInputMappingSnapshot = {
  config: DirectInputMappingConfig;
  store: DataStoreDescriptor;
};
