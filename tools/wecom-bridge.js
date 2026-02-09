#!/usr/bin/env node

// Minimal WeCom callback bridge (plaintext mode only).
// - POST /wecom: receive WeCom XML, verify signature, push to SSE clients
// - GET /stream: SSE stream of messages for local agent

require("dotenv").config();
const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");
const { XMLParser } = require("fast-xml-parser");
const { fetch, FormData, File } = require("undici");

const PORT = Number(process.env.PORT || 8080);
const WECOM_TOKEN = process.env.WECOM_TOKEN || "";
const WECOM_AES_KEY = process.env.WECOM_AES_KEY || "";
const WECOM_RECEIVE_ID = process.env.WECOM_RECEIVE_ID || "";
const BRIDGE_TOKEN = process.env.WECOM_BRIDGE_TOKEN || "";
const MESSAGE_BUFFER_SIZE = Number(process.env.BRIDGE_BUFFER_SIZE || 200);

const clients = new Set();
const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: false });
let nextEventId = 1;
const messageBuffer = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/stream") {
    console.log("wecom stream");
    if (BRIDGE_TOKEN) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    console.log("wecom stream success");
    res.write("\n");
    const lastEventIdHeader = req.headers["last-event-id"];
    const lastEventIdQuery = url.searchParams.get("lastEventId");
    const lastEventId = Number(lastEventIdHeader || lastEventIdQuery || 0);
    if (Number.isFinite(lastEventId) && lastEventId > 0) {
      const missed = messageBuffer.filter((item) => item.id > lastEventId);
      for (const item of missed) {
        writeSse(res, item.id, item.payload);
      }
      console.log(`wecom stream replay ${missed.length} messages since ${lastEventId}`);
    }
    clients.add(res);
    req.on("close", () => clients.delete(res));
    console.log("wecom stream close");
    return;
  }

  if (req.method === "POST" && url.pathname === "/proxy/gettoken") {
    if (BRIDGE_TOKEN) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
    }

    const body = await readBody(req);
    if (!body) {
      res.writeHead(400);
      res.end("missing body");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end("invalid json");
      return;
    }

    try {
      const token = await proxyGetToken(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(token));
      return;
    } catch (err) {
      res.writeHead(500);
      console.log("wecom post gettoken failed", err);
      res.end(`gettoken failed: ${(err && err.message) || "unknown"}`);
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/proxy/send") {
    if (BRIDGE_TOKEN) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
    }

    const body = await readBody(req);
    if (!body) {
      res.writeHead(400);
      res.end("missing body");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end("invalid json");
      return;
    }

    try {
      const ok = await proxySendMessage(payload);
      if (!ok) {
        res.writeHead(500);
        res.end("send failed");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
      return;
    } catch (err) {
      res.writeHead(500);
      console.log("wecom post send failed", err);
      res.end(`send failed: ${(err && err.message) || "unknown"}`);
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/proxy/media/upload") {
    if (BRIDGE_TOKEN) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
    }

    const body = await readBody(req);
    if (!body) {
      res.writeHead(400);
      res.end("missing body");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end("invalid json");
      return;
    }

    try {
      const data = await proxyUploadMedia(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    } catch (err) {
      res.writeHead(500);
      const detail = err && err.cause && err.cause.message ? ` (${err.cause.message})` : "";
      console.log("wecom post upload failed", err && err.stack ? err.stack : err);
      res.end(`upload failed: ${(err && err.message) || "unknown"}${detail}`);
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/wecom") {
    const { signature, msg_signature, timestamp, nonce, echostr } = Object.fromEntries(url.searchParams);
    const provided = msg_signature || signature || "";

    if (!WECOM_TOKEN || !WECOM_AES_KEY) {
      res.writeHead(500);
      res.end("missing token or aes key");
      return;
    }

    const expected = sha1(sortedJoin([WECOM_TOKEN, timestamp, nonce, echostr]));
    if (!provided || provided !== expected) {
      res.writeHead(401);
      res.end("invalid signature");
      return;
    }

    if (!echostr) {
      res.writeHead(400);
      res.end("missing echostr");
      return;
    }

    const decrypted = decryptWeCom(echostr, WECOM_AES_KEY, WECOM_RECEIVE_ID);
    if (!decrypted.ok) {
      res.writeHead(400);
      res.end("decrypt failed");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(decrypted.message);
    return;
  }

  if (req.method === "POST" && url.pathname === "/wecom") {
    console.log("wecom post", url.searchParams);
    const { signature, msg_signature, timestamp, nonce } = Object.fromEntries(url.searchParams);
    const provided = msg_signature || signature || "";

    if (!WECOM_TOKEN || !WECOM_AES_KEY) {
      res.writeHead(500);
      console.log("wecom post missing token or aes key");
      res.end("missing token or aes key");
      return;
    }

    const body = await readBody(req);
    if (!body) {
      res.writeHead(400);
      console.log("wecom post missing body");
      res.end("missing body");
      return;
    }
    console.log("wecom post body", body);

    const encrypted = extractEncrypted(body);
    console.log("wecom post encrypted", encrypted);
    if (!encrypted) {
      res.writeHead(400);
      console.log("wecom post missing encrypt");
      res.end("missing encrypt");
      return;
    }

    const expected = sha1(sortedJoin([WECOM_TOKEN, timestamp, nonce, encrypted]));
    if (!provided || provided !== expected) {
      res.writeHead(401);
      console.log("wecom post invalid signature");
      res.end("invalid signature");
      return;
    }

    const decrypted = decryptWeCom(encrypted, WECOM_AES_KEY, WECOM_RECEIVE_ID);
    if (!decrypted.ok) {
      res.writeHead(400);
      console.log("wecom post decrypt failed");
      res.end("decrypt failed");
      return;
    }

    const msg = parseWeComMessage(decrypted.message);
    console.log("wecom post msg", msg);
    if (!msg) {
      res.writeHead(200);
      console.log("wecom post success");
      res.end("success");
      return;
    }

    const payload = {
      messageId: msg.msgId || `${msg.fromUser}-${Date.now()}`,
      sessionId: msg.fromUser,
      fromUser: msg.fromUser,
      toUser: msg.toUser,
      text: msg.content,
      msgType: msg.msgType,
      mediaId: msg.mediaId,
      picUrl: msg.picUrl,
      receivedAt: new Date().toISOString()
    };

    broadcast(payload);
    res.writeHead(200);
    console.log("wecom post success");
    res.end("success");
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`wecom-bridge listening on :${PORT}`);
});

async function proxyGetToken(payload) {
  if (!payload || !payload.corpid || !payload.corpsecret) {
    throw new Error("missing corpid/corpsecret");
  }
  const qs = new URLSearchParams({
    corpid: payload.corpid,
    corpsecret: payload.corpsecret
  });
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?${qs.toString()}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`token http ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`token error ${data.errcode || "unknown"}`);
  return data;
}

async function proxySendMessage(payload) {
  if (!payload || !payload.access_token || !payload.message) {
    throw new Error("missing access_token/message");
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${payload.access_token}`;
  const body = payload.message;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) return false;
  const data = await res.json();
  return !data.errcode || data.errcode === 0;
}

async function proxyUploadMedia(payload) {
  if (!payload || !payload.access_token || !payload.media || !payload.media.base64) {
    throw new Error("missing access_token/media");
  }
  const type = payload.type || "image";
  const url = `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${payload.access_token}&type=${type}`;

  const filename = payload.media.filename || `upload.${type === "image" ? "jpg" : "dat"}`;
  const contentType = payload.media.content_type || "application/octet-stream";
  const buffer = Buffer.from(payload.media.base64, "base64");

  const form = new FormData();
  const file = new File([buffer], filename, { type: contentType });
  form.append("media", file);

  const res = await fetch(url, {
    method: "POST",
    body: form
  });
  console.log("upload res", res);
  if (!res.ok) throw new Error(`upload http ${res.status}`);
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`upload error ${data.errcode}`);
  }
  return data;
}

function broadcast(payload) {
  const id = nextEventId++;
  const item = { id, payload };
  messageBuffer.push(item);
  if (messageBuffer.length > MESSAGE_BUFFER_SIZE) {
    messageBuffer.splice(0, messageBuffer.length - MESSAGE_BUFFER_SIZE);
  }
  for (const res of clients) {
    writeSse(res, id, payload);
  }
}

function writeSse(res, id, payload) {
  res.write(`id: ${id}\n`);
  res.write("event: message\n");
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function sortedJoin(parts) {
  return parts.filter(Boolean).sort().join("");
}

function parseWeComMessage(xml) {
  const doc = parseXml(xml);
  if (!doc) return null;
  const msgType = String(doc.MsgType || "");
  const content = String(doc.Content || "");
  const fromUser = String(doc.FromUserName || "");
  const toUser = String(doc.ToUserName || "");
  const msgId = String(doc.MsgId || doc.MsgID || "");
  const mediaId = String(doc.MediaId || "");
  const picUrl = String(doc.PicUrl || "");

  if (!msgType || !fromUser) return null;

  return {
    msgType,
    content: content || "",
    fromUser,
    toUser: toUser || "",
    msgId: msgId || "",
    mediaId: mediaId || "",
    picUrl: picUrl || ""
  };
}

function extractEncrypted(body) {
  const trimmed = String(body).trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      return String(obj.encrypt || obj.Encrypt || "");
    } catch {
      return "";
    }
  }

  const doc = parseXml(body);
  if (!doc) return "";
  return String(doc.Encrypt || "");
}

function parseXml(xml) {
  try {
    const parsed = xmlParser.parse(xml);
    return parsed.xml || parsed;
  } catch {
    return null;
  }
}

function decryptWeCom(encrypted, aesKey, receiveId) {
  try {
    const key = Buffer.from(`${aesKey}=`, "base64");
    if (key.length !== 32) {
      return { ok: false, message: "" };
    }

    const iv = key.subarray(0, 16);
    const cipherText = Buffer.from(encrypted, "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    decrypted = pkcs7Unpad(decrypted);

    const msgLen = decrypted.readUInt32BE(16);
    const msgStart = 20;
    const msgEnd = msgStart + msgLen;
    const msg = decrypted.subarray(msgStart, msgEnd).toString("utf-8");
    const rid = decrypted.subarray(msgEnd).toString("utf-8");

    if (receiveId && rid !== receiveId) {
      return { ok: false, message: "" };
    }

    return { ok: true, message: msg };
  } catch {
    return { ok: false, message: "" };
  }
}

function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.subarray(0, buf.length - pad);
}
