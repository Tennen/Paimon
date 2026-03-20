import crypto from "crypto";
import { Express, Request, Response as ExResponse } from "express";
import { XMLParser } from "fast-xml-parser";
import { IngressAdapter } from "./types";
import { SessionManager } from "../core/sessionManager";
import { Envelope } from "../types";
import { WeComMediaDownloader } from "../integrations/wecom/mediaDownloader";
import { ObservableMenuService } from "../observable/menuService";

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false
});

export class WeComIngressAdapter implements IngressAdapter {
  private readonly token: string;
  private readonly mediaDownloader: WeComMediaDownloader;
  private readonly observableMenuService: ObservableMenuService;

  constructor(token?: string, mediaDownloader?: WeComMediaDownloader, observableMenuService?: ObservableMenuService) {
    this.token = token ?? process.env.WECOM_TOKEN ?? "";
    this.mediaDownloader = mediaDownloader ?? new WeComMediaDownloader();
    this.observableMenuService = observableMenuService ?? new ObservableMenuService();
  }

  register(app: Express, sessionManager: SessionManager): void {
    app.get("/ingress/wecom", (req, res) => {
      const { signature, msg_signature, timestamp, nonce, echostr } = req.query as Record<string, string>;
      const provided = msg_signature ?? signature ?? "";

      if (!this.token) {
        res.status(500).send("missing token");
        return;
      }

      const expected = sha1(sortedJoin([this.token, timestamp, nonce, echostr]));
      if (!provided || provided !== expected) {
        res.status(401).send("invalid signature");
        return;
      }

      res.send(echostr ?? "");
    });

    app.post("/ingress/wecom", rawXmlMiddleware, async (req: Request, res: ExResponse) => {
      if (!this.token) {
        res.status(500).send("missing token");
        return;
      }

      const { signature, msg_signature, timestamp, nonce } = req.query as Record<string, string>;
      const provided = msg_signature ?? signature ?? "";
      const expected = sha1(sortedJoin([this.token, timestamp, nonce]));
      if (!provided || provided !== expected) {
        res.status(401).send("invalid signature");
        return;
      }

      const raw = req.body as string;
      if (!raw || typeof raw !== "string") {
        res.status(400).send("missing body");
        return;
      }

      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = (xmlParser.parse(raw) as { xml?: Record<string, unknown> }).xml;
      } catch {
        res.status(400).send("invalid xml");
        return;
      }

      if (!parsed) {
        res.status(400).send("invalid xml");
        return;
      }

      const msgType = String(parsed.MsgType ?? "").trim().toLowerCase();
      const fromUser = String(parsed.FromUserName ?? "");
      const toUser = String(parsed.ToUserName ?? "");
      const agentId = String(parsed.AgentID ?? parsed.AgentId ?? "").trim();

      if (msgType === "event") {
        const eventType = String(parsed.Event ?? "").trim().toLowerCase();
        if (eventType !== "click") {
          res.status(200).send("success");
          return;
        }

        const eventKey = String(parsed.EventKey ?? "").trim();
        if (!fromUser || !eventKey) {
          res.status(400).send("missing fields");
          return;
        }

        const handled = this.observableMenuService.handleWeComClickEvent({
          eventKey,
          fromUser,
          toUser,
          agentId,
          receivedAt: new Date().toISOString()
        });

        if (!handled.dispatchText) {
          if (!handled.replyText) {
            res.status(200).send("success");
            return;
          }
          const reply = buildTextReply(fromUser, toUser, handled.replyText);
          res.type("application/xml").send(reply);
          return;
        }

        const envelope = buildMenuEventEnvelope({
          requestId: handled.event.id,
          fromUser,
          toUser,
          agentId,
          eventKey,
          dispatchText: handled.dispatchText,
          receivedAt: handled.event.receivedAt
        });

        try {
          const response = await sessionManager.enqueue(envelope);
          if (hasResponseImages(response)) {
            const unsupportedReply = buildTextReply(
              fromUser,
              toUser,
              "当前通道不支持图片回复，请使用 WeCom bridge 通道。"
            );
            res.type("application/xml").send(unsupportedReply);
            return;
          }

          const responseText = String(response.text ?? "").trim();
          if (!responseText) {
            res.status(200).send("success");
            return;
          }
          const reply = buildTextReply(fromUser, toUser, responseText);
          res.type("application/xml").send(reply);
        } catch (error) {
          this.observableMenuService.markEventDispatchFailed(handled.event.id, error);
          console.error(`[wecom] menu event dispatch failed: ${eventKey}`, error);
          const reply = buildTextReply(fromUser, toUser, "菜单事件处理失败，请稍后重试。");
          res.type("application/xml").send(reply);
        }
        return;
      }

      const isText = msgType === "text";
      const isVoice = msgType === "voice";
      if (!isText && !isVoice) {
        res.status(200).send("success");
        return;
      }

      const content = String(parsed.Content ?? "").trim();
      const recognition = String(parsed.Recognition ?? "").trim();
      const msgId = String(parsed.MsgId ?? parsed.MsgID ?? "");
      const mediaId = String(parsed.MediaId ?? "").trim();

      if (!fromUser || (isText && !content)) {
        res.status(400).send("missing fields");
        return;
      }

      let audioPath: string | undefined;
      const fallbackVoiceText = recognition;

      if (isVoice) {
        if (!mediaId) {
          const reply = buildTextReply(fromUser, toUser, "收到语音但缺少 media_id，无法识别。");
          res.type("application/xml").send(reply);
          return;
        }

        try {
          audioPath = await this.mediaDownloader.downloadVoice(mediaId, msgId || `${fromUser}-${Date.now()}`);
        } catch (error) {
          console.error(`[wecom] voice media download failed: ${mediaId}`, error);
          if (!fallbackVoiceText) {
            const reply = buildTextReply(fromUser, toUser, "语音下载失败，请稍后重试。");
            res.type("application/xml").send(reply);
            return;
          }
        }
      }

      const envelope: Envelope = {
        requestId: msgId || `${fromUser}-${Date.now()}`,
        source: "wecom",
        sessionId: fromUser,
        kind: isVoice ? "audio" : "text",
        text: isVoice ? (audioPath ? undefined : fallbackVoiceText || undefined) : content,
        audioPath,
        meta: {
          ingress_message_id: msgId || undefined,
          callback_to_user: fromUser,
          wecom_msg_type: msgType,
          wecom_media_id: mediaId || undefined
        },
        receivedAt: new Date().toISOString()
      };

      try {
        const response = await sessionManager.enqueue(envelope);
        if (hasResponseImages(response)) {
          const unsupportedReply = buildTextReply(
            fromUser,
            toUser,
            "当前通道不支持图片回复，请使用 WeCom bridge 通道。"
          );
          res.type("application/xml").send(unsupportedReply);
          return;
        }
        const reply = buildTextReply(fromUser, toUser, response.text);
        res.type("application/xml").send(reply);
      } catch {
        res.status(500).send("internal error");
      }
    });
  }
}

function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function sortedJoin(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).sort().join("");
}

function buildTextReply(toUser: string, fromUser: string, content: string): string {
  const now = Math.floor(Date.now() / 1000);
  return (
    "<xml>" +
    `<ToUserName><![CDATA[${toUser}]]></ToUserName>` +
    `<FromUserName><![CDATA[${fromUser}]]></FromUserName>` +
    `<CreateTime>${now}</CreateTime>` +
    "<MsgType><![CDATA[text]]></MsgType>" +
    `<Content><![CDATA[${content}]]></Content>` +
    "</xml>"
  );
}

function buildMenuEventEnvelope(input: {
  requestId: string;
  fromUser: string;
  toUser: string;
  agentId?: string;
  eventKey: string;
  dispatchText: string;
  receivedAt: string;
}): Envelope {
  return {
    requestId: input.requestId,
    source: "wecom",
    sessionId: input.fromUser,
    kind: "text",
    text: input.dispatchText,
    meta: {
      callback_to_user: input.fromUser,
      wecom_msg_type: "event",
      wecom_event_type: "click",
      wecom_event_key: input.eventKey,
      wecom_agent_id: input.agentId || undefined
    },
    receivedAt: input.receivedAt
  };
}

function hasResponseImages(response: { data?: { image?: unknown; images?: unknown[] } }): boolean {
  if (!response || !response.data) {
    return false;
  }
  if (response.data.image) {
    return true;
  }
  return Array.isArray(response.data.images) && response.data.images.length > 0;
}

function rawXmlMiddleware(req: Request, res: ExResponse, next: () => void): void {
  if (req.is("text/xml") || req.is("application/xml") || req.is("*/xml")) {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      (req as Request & { body: string }).body = data;
      next();
    });
    return;
  }

  res.status(415).send("unsupported content-type");
}
