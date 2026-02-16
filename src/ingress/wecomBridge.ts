import { Express } from "express";
import { fetch } from "undici";
import { IngressAdapter } from "./types";
import { SessionManager } from "../sessionManager";
import { Envelope } from "../types";
import { WeComSender } from "../wecom/sender";

export class WeComBridgeIngressAdapter implements IngressAdapter {
  private readonly streamUrl: string;
  private readonly token: string;
  private readonly sender: WeComSender;
  private readonly contextLimit: number;
  private readonly contextMap = new Map<string, WeComContext>();

  constructor(streamUrl?: string, token?: string) {
    this.streamUrl = streamUrl ?? process.env.WECOM_BRIDGE_URL ?? "";
    this.token = token ?? process.env.WECOM_BRIDGE_TOKEN ?? "";
    this.sender = new WeComSender();
    this.contextLimit = Number(process.env.WECOM_CONTEXT_LIMIT ?? "1000");
  }

  register(_app: Express, sessionManager: SessionManager): void {
    if (!this.streamUrl) {
      log("bridge disabled: WECOM_BRIDGE_URL missing");
      return;
    }

    const url = this.streamUrl.replace(/\/$/, "") + "/stream";
    log(`connecting to bridge: ${url}`);
    void connectSse(url, this.token, async (payload) => {
      log(`message received: ${payload.messageId} session=${payload.sessionId}`);
      this.upsertContext(payload.sessionId, payload.fromUser);
      const isImage = payload.msgType === "image";
      const envelope: Envelope = {
        requestId: payload.messageId,
        source: "wecom",
        sessionId: payload.sessionId,
        kind: isImage ? "image" : "text",
        text: isImage ? undefined : payload.text,
        meta: {
          ingress_message_id: payload.messageId,
          callback_to_user: payload.fromUser,
          wecom_media_id: payload.mediaId,
          wecom_pic_url: payload.picUrl
        },
        receivedAt: payload.receivedAt
      };

      try {
        const response = await sessionManager.enqueue(envelope);
        await this.sender.sendResponse(payload.fromUser, response);
      } catch (err: any) {
        log(`send reply failed: ${(err as Error).message} ${err && err.stack ? err.stack : ""}`);
      }
    });
  }

  private upsertContext(sessionId: string, toUser: string): void {
    this.contextMap.delete(sessionId);
    this.contextMap.set(sessionId, { toUser, updatedAt: Date.now() });
    if (this.contextMap.size > this.contextLimit) {
      const oldest = this.contextMap.keys().next().value;
      if (oldest) this.contextMap.delete(oldest);
    }
  }
}

type BridgePayload = {
  messageId: string;
  sessionId: string;
  fromUser: string;
  toUser?: string;
  text: string;
  msgType?: string;
  mediaId?: string;
  picUrl?: string;
  receivedAt: string;
};

type WeComContext = {
  toUser: string;
  updatedAt: number;
};

async function connectSse(url: string, token: string, onMessage: (p: BridgePayload) => void): Promise<void> {
  while (true) {
    try {
      log("opening SSE connection...");
      const res = await fetch(url, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!res.ok || !res.body) {
        log(`SSE connect failed: status=${res.status}`);
        await sleep(2000);
        continue;
      }

      log("SSE connected");
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const data = parseSseData(rawEvent);
          console.log("SSE data", data);
          if (!data) continue;
          try {
            const payload = JSON.parse(data) as BridgePayload;
            if (payload && payload.messageId && payload.sessionId) {
              onMessage(payload);
            }
          } catch (err) {
            log(`SSE parse error: ${(err as Error).message}`);
            continue;
          }
        }
      }
    } catch(err) {
      log(`SSE connection error: ${(err as Error).message}`);
    }

    await sleep(1000);
  }
}

function parseSseData(eventChunk: string): string | null {
  const lines = eventChunk.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  const ts = new Date().toISOString();
  console.log(`[wecom-bridge] ${ts} ${message}`);
}
