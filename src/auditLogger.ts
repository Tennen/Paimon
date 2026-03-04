import type { LLMProvider } from "./engines/llm/llm";
import { appendStore, DATA_STORE, registerStore } from "./storage/persistence";

export type AuditEntry = {
  requestId: string;
  sessionId: string;
  source?: string;
  ingress_message_id?: string;
  actionType: string;
  latencyMs: number;
  tool?: string;
  tool_meta?: unknown;
  llm_provider?: LLMProvider;
  model?: string;
  retries?: number;
  parse_ok?: boolean;
  raw_output_length?: number;
  fallback?: boolean;
};

const AUDIT_STORE = DATA_STORE.AUDIT_LOG;
let auditStoreRegistered = false;

export function writeAudit(entry: AuditEntry): void {
  if (!auditStoreRegistered) {
    registerStore(AUDIT_STORE, {
      init: () => "",
      codec: "text"
    });
    auditStoreRegistered = true;
  }
  const line = JSON.stringify({
    ...entry,
    "action.type": entry.actionType,
    ts: new Date().toISOString()
  });
  appendStore(AUDIT_STORE, `${line}\n`);
}
