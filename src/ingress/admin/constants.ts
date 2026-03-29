import path from "path";
import { DATA_STORE } from "../../storage/persistence";

export const DEFAULT_ADMIN_DIST_CANDIDATES = [
  path.resolve(process.cwd(), "dist/admin-web"),
  path.resolve(process.cwd(), "admin-web/dist")
];

export const TOPIC_SUMMARY_CONFIG_STORE = DATA_STORE.TOPIC_SUMMARY_CONFIG;
export const TOPIC_SUMMARY_STATE_STORE = DATA_STORE.TOPIC_SUMMARY_STATE;
export const WRITING_ORGANIZER_INDEX_STORE = DATA_STORE.WRITING_ORGANIZER_INDEX;
