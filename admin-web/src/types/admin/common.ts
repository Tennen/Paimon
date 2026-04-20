export type DataStoreDescriptor = {
  name: string;
  driver: string;
  codec?: "json" | "text";
};

export type Notice = {
  type: "success" | "error" | "info";
  title: string;
  text?: string;
} | null;

export type MenuKey =
  | "system"
  | "conversation"
  | "messages"
  | "direct_input"
  | "wecom"
  | "celestia"
  | "market"
  | "topic"
  | "writing"
  | "evolution";
