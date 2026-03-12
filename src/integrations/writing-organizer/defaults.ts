import { DATA_STORE } from "../../storage/persistence";
import { WritingOrganizerIndexStore, WritingTopicState } from "./types";

export const WRITING_ORGANIZER_INDEX_STORE = DATA_STORE.WRITING_ORGANIZER_INDEX;
export const WRITING_DIRECT_COMMANDS = ["/writing"];
export const WRITING_RAW_MAX_LINES = 200;
export const WRITING_DEFAULT_TOPIC_STATUS = "active" as const;

export function cloneEmptyTopicState(): WritingTopicState {
  return {
    summary: "",
    outline: "",
    draft: ""
  };
}

export function createDefaultIndexStore(): WritingOrganizerIndexStore {
  return {
    version: 1,
    topicIds: [],
    updatedAt: new Date(0).toISOString()
  };
}
