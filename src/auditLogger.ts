import fs from "fs";
import path from "path";

export type AuditEntry = {
  requestId: string;
  sessionId: string;
  source?: string;
  ingress_message_id?: string;
  actionType: string;
  latencyMs: number;
  tool?: string;
  tool_meta?: unknown;
  llm_provider?: "ollama";
  model?: string;
  retries?: number;
  parse_ok?: boolean;
  raw_output_length?: number;
  fallback?: boolean;
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
