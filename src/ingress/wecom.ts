import crypto from "crypto";
import { Express, Request, Response as ExResponse } from "express";
import { XMLParser } from "fast-xml-parser";
import { IngressAdapter } from "./types";
import { SessionManager } from "../core/sessionManager";
import { Envelope } from "../types";

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false
});

export class WeComIngressAdapter implements IngressAdapter {
  private readonly token: string;

  constructor(token?: string) {
    this.token = token ?? process.env.WECOM_TOKEN ?? "";
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

      const msgType = String(parsed.MsgType ?? "");
      if (msgType !== "text") {
        res.status(200).send("success");
        return;
      }

      const content = String(parsed.Content ?? "").trim();
      const fromUser = String(parsed.FromUserName ?? "");
      const toUser = String(parsed.ToUserName ?? "");
      const msgId = String(parsed.MsgId ?? parsed.MsgID ?? "");

      if (!fromUser || !content) {
        res.status(400).send("missing fields");
        return;
      }

      const envelope: Envelope = {
        requestId: msgId || `${fromUser}-${Date.now()}`,
        source: "wecom",
        sessionId: fromUser,
        kind: "text",
        text: content,
        meta: {
          ingress_message_id: msgId || undefined,
          callback_to_user: fromUser
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
