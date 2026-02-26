import crypto from "crypto";
import { Express, Request, Response as ExResponse } from "express";
import { XMLParser } from "fast-xml-parser";
import { IngressAdapter } from "./types";
import { SessionManager } from "../core/sessionManager";
import { Envelope } from "../types";
import { WeComMediaDownloader } from "../endpoints/wecom/mediaDownloader";

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false
});

export class WeComIngressAdapter implements IngressAdapter {
  private readonly token: string;
  private readonly mediaDownloader: WeComMediaDownloader;

  constructor(token?: string, mediaDownloader?: WeComMediaDownloader) {
    this.token = token ?? process.env.WECOM_TOKEN ?? "";
    this.mediaDownloader = mediaDownloader ?? new WeComMediaDownloader();
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
      const isText = msgType === "text";
      const isVoice = msgType === "voice";
      if (!isText && !isVoice) {
        res.status(200).send("success");
        return;
      }

      const content = String(parsed.Content ?? "").trim();
      const recognition = String(parsed.Recognition ?? "").trim();
      const fromUser = String(parsed.FromUserName ?? "");
      const toUser = String(parsed.ToUserName ?? "");
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
