import { Express, Request, Response as ExResponse } from "express";
import { IngressAdapter } from "./types";
import { SessionManager } from "../core/sessionManager";
import { WeComSender } from "../endpoints/wecom/sender";

type HANotifyPayload = {
  message?: string;
  data?: Record<string, unknown>;
};

export class HANotifyIngressAdapter implements IngressAdapter {
  private readonly authToken: string;
  private readonly toUser: string;
  private readonly sender: WeComSender;

  constructor(authToken?: string, toUser?: string) {
    this.authToken = authToken ?? process.env.HA_NOTIFY_TOKEN ?? process.env.LLM_SERVICE_TOKEN ?? "";
    this.toUser = toUser ?? process.env.WECOM_NOTIFY_TO ?? "";
    this.sender = new WeComSender();
  }

  register(app: Express, _sessionManager: SessionManager): void {
    app.post("/hass_notify", async (req: Request, res: ExResponse) => {
      if (!this.toUser) {
        res.status(500).json({ error: "WECOM_NOTIFY_TO missing" });
        return;
      }

      if (this.authToken) {
        const provided = String(req.header("X-Auth-Token") ?? "");
        if (!provided || provided !== this.authToken) {
          res.status(401).json({ error: "invalid token" });
          return;
        }
      }

      const body = (req.body ?? {}) as HANotifyPayload;
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const data = body.data && typeof body.data === "object" ? body.data : undefined;

      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const content = formatMessage(message, data);

      try {
        await this.sender.sendText(this.toUser, content);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ error: (err as Error).message ?? "send failed" });
      }
    });
  }
}

function formatMessage(message: string, data?: Record<string, unknown>): string {
  if (!data) return message;

  const title = typeof data.title === "string" ? data.title.trim() : "";
  const lines: string[] = [];
  if (title) lines.push(title);
  lines.push(message);

  const extra: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "title") continue;
    if (value === undefined || value === null || value === "") continue;
    extra.push(`${key}: ${stringifyValue(value)}`);
  }

  if (extra.length > 0) {
    lines.push("");
    lines.push(...extra);
  }

  return lines.join("\n");
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
