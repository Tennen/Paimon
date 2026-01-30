import fs from "fs";
import path from "path";

export type AuditEntry = {
  requestId: string;
  sessionId: string;
  actionType: string;
  latencyMs: number;
  tool?: string;
  ha_action?: "call_service" | "get_state";
  entity_id?: string | string[];
};

const AUDIT_PATH = path.resolve(process.cwd(), "data", "audit.jsonl");

export function writeAudit(entry: AuditEntry): void {
  const dir = path.dirname(AUDIT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify({
    ...entry,
    "action.type": entry.actionType,
    ts: new Date().toISOString()
  });
  fs.appendFileSync(AUDIT_PATH, line + "\n", "utf-8");
}
