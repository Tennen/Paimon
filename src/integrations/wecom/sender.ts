import { fetch } from "undici";
import { Response } from "../../types";

export type WeComSenderConfig = {
  corpId: string;
  appSecret: string;
  agentId: string;
  bridgeUrl: string;
  bridgeToken: string;
};

type TokenCache = {
  value: string;
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

const WECOM_TEXT_MAX_BYTES = normalizePositiveInteger(process.env.WECOM_TEXT_MAX_BYTES, 1800);
const UTF8_ENCODER = new TextEncoder();

export class WeComSender {
  private readonly config: WeComSenderConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config?: Partial<WeComSenderConfig>) {
    this.config = {
      corpId: config?.corpId ?? process.env.WECOM_CORP_ID ?? "",
      appSecret: config?.appSecret ?? process.env.WECOM_APP_SECRET ?? "",
      agentId: config?.agentId ?? process.env.WECOM_AGENT_ID ?? "",
      bridgeUrl: config?.bridgeUrl ?? process.env.WECOM_BRIDGE_URL ?? "",
      bridgeToken: config?.bridgeToken ?? process.env.WECOM_BRIDGE_TOKEN ?? ""
    };
  }

  async sendText(toUser: string, content: string): Promise<void> {
    if (!this.config.corpId || !this.config.appSecret || !this.config.agentId) {
      throw new Error("WECOM_CORP_ID/WECOM_APP_SECRET/WECOM_AGENT_ID missing");
    }
    if (!this.config.bridgeUrl) {
      throw new Error("WECOM_BRIDGE_URL missing for send");
    }

    const token = await this.getTokenViaBridge();
    const url = this.config.bridgeUrl.replace(/\/$/, "") + "/proxy/send";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.bridgeToken ? { Authorization: `Bearer ${this.config.bridgeToken}` } : {})
      },
      body: JSON.stringify({
        access_token: token,
        message: {
          touser: toUser,
          msgtype: "text",
          agentid: Number(this.config.agentId),
          text: { content }
        }
      })
    });

    if (!res.ok) {
      throw new Error(`wecom bridge send http ${res.status}`);
    }

    const data = (await res.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`wecom bridge send error ${data.errcode}: ${data.errmsg ?? ""}`);
    }
  }

  async sendImage(toUser: string, base64: string, filename?: string, contentType?: string): Promise<void> {
    if (!this.config.corpId || !this.config.appSecret || !this.config.agentId) {
      throw new Error("WECOM_CORP_ID/WECOM_APP_SECRET/WECOM_AGENT_ID missing");
    }
    if (!this.config.bridgeUrl) {
      throw new Error("WECOM_BRIDGE_URL missing for send");
    }

    const token = await this.getTokenViaBridge();
    const uploadUrl = this.config.bridgeUrl.replace(/\/$/, "") + "/proxy/media/upload";
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.bridgeToken ? { Authorization: `Bearer ${this.config.bridgeToken}` } : {})
      },
      body: JSON.stringify({
        access_token: token,
        type: "image",
        media: {
          base64,
          filename,
          content_type: contentType
        }
      })
    });
    console.log("uploadRes", uploadRes);
    if (!uploadRes.ok) {
      throw new Error(`wecom bridge upload http ${uploadRes.status} ${await uploadRes.text()}`);
    }

    const uploadData = (await uploadRes.json()) as { media_id?: string; errcode?: number; errmsg?: string };
    if (!uploadData.media_id) {
      throw new Error(`wecom bridge upload error ${uploadData.errcode ?? "unknown"}: ${uploadData.errmsg ?? ""}`);
    }

    const url = this.config.bridgeUrl.replace(/\/$/, "") + "/proxy/send";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.bridgeToken ? { Authorization: `Bearer ${this.config.bridgeToken}` } : {})
      },
      body: JSON.stringify({
        access_token: token,
        message: {
          touser: toUser,
          msgtype: "image",
          agentid: Number(this.config.agentId),
          image: { media_id: uploadData.media_id }
        }
      })
    });

    if (!res.ok) {
      throw new Error(`wecom bridge send http ${res.status}`);
    }

    const data = (await res.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`wecom bridge send error ${data.errcode}: ${data.errmsg ?? ""}`);
    }
  }

  async sendResponse(toUser: string, response: Response): Promise<void> {
    const images = collectResponseImages(response);
    if (isImageRequiredResponse(response) && images.length === 0) {
      throw new Error("wecom response declares image delivery but no image payload is present");
    }

    for (const image of images) {
      await this.sendImage(toUser, image.data, image.filename, image.contentType);
    }

    if (response.text) {
      const chunks = splitTextByUtf8Bytes(response.text, WECOM_TEXT_MAX_BYTES);
      for (const chunk of chunks) {
        await this.sendText(toUser, chunk);
      }
    }
  }

  private async getTokenViaBridge(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 5000) {
      return this.tokenCache.value;
    }

    const url = this.config.bridgeUrl.replace(/\/$/, "") + "/proxy/gettoken";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.bridgeToken ? { Authorization: `Bearer ${this.config.bridgeToken}` } : {})
      },
      body: JSON.stringify({
        corpid: this.config.corpId,
        corpsecret: this.config.appSecret
      })
    });

    if (!res.ok) {
      throw new Error(`wecom bridge gettoken http ${res.status}`);
    }

    const data = (await res.json()) as TokenResponse;
    if (!data.access_token) {
      throw new Error(`wecom bridge gettoken error ${data.errcode ?? "unknown"}: ${data.errmsg ?? ""}`);
    }

    const ttlMs = (data.expires_in ?? 7200) * 1000;
    this.tokenCache = { value: data.access_token, expiresAt: now + ttlMs };
    return data.access_token;
  }
}

function splitTextByUtf8Bytes(content: string, maxBytes: number): string[] {
  const text = String(content ?? "").trim();
  if (!text) {
    return [];
  }

  if (getUtf8Bytes(text) <= maxBytes) {
    return [text];
  }

  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const normalized = current.trim();
    if (normalized) {
      chunks.push(normalized);
    }
    current = "";
  };

  const appendPart = (part: string) => {
    if (!part) {
      return;
    }
    const candidate = current ? `${current}\n${part}` : part;
    if (getUtf8Bytes(candidate) <= maxBytes) {
      current = candidate;
      return;
    }

    if (current) {
      pushCurrent();
    }

    if (getUtf8Bytes(part) <= maxBytes) {
      current = part;
      return;
    }

    const hardChunks = splitHardByUtf8Bytes(part, maxBytes);
    for (let i = 0; i < hardChunks.length; i += 1) {
      const hardChunk = hardChunks[i];
      if (i === hardChunks.length - 1) {
        current = hardChunk;
      } else {
        chunks.push(hardChunk);
      }
    }
  };

  for (const line of lines) {
    appendPart(line);
  }
  if (current) {
    pushCurrent();
  }

  return chunks.length > 0 ? chunks : [text];
}

function splitHardByUtf8Bytes(text: string, maxBytes: number): string[] {
  const out: string[] = [];
  let current = "";

  for (const ch of text) {
    const next = current + ch;
    if (getUtf8Bytes(next) <= maxBytes) {
      current = next;
      continue;
    }

    if (current) {
      out.push(current);
    }
    current = ch;

    if (getUtf8Bytes(current) > maxBytes) {
      out.push(current);
      current = "";
    }
  }

  if (current) {
    out.push(current);
  }
  return out;
}

function getUtf8Bytes(text: string): number {
  return UTF8_ENCODER.encode(text).length;
}

function normalizePositiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function collectResponseImages(response: Response): Array<{ data: string; filename?: string; contentType?: string }> {
  const out: Array<{ data: string; filename?: string; contentType?: string }> = [];
  const dedup = new Set<string>();

  const push = (image: { data: string; filename?: string; contentType?: string } | undefined) => {
    if (!image?.data) return;
    if (dedup.has(image.data)) return;
    dedup.add(image.data);
    out.push(image);
  };

  push(response.data?.image);
  if (Array.isArray(response.data?.images)) {
    for (const image of response.data.images) {
      push(image);
    }
  }

  return out;
}

function isImageRequiredResponse(response: Response): boolean {
  const root = response as unknown as Record<string, unknown>;
  const data = (response.data && typeof response.data === "object")
    ? response.data as unknown as Record<string, unknown>
    : undefined;
  return hasImageRequiredFlag(root) || hasImageRequiredFlag(data);
}

function hasImageRequiredFlag(payload?: Record<string, unknown>): boolean {
  if (!payload) {
    return false;
  }

  if (
    payload.requiresImage === true
    || payload.requireImage === true
    || payload.imageRequired === true
    || payload.requiresImages === true
    || payload.requireImages === true
  ) {
    return true;
  }

  const requiredMediaType = String(payload.requiredMediaType ?? "").trim().toLowerCase();
  if (requiredMediaType === "image") {
    return true;
  }

  const requiredMediaTypes = Array.isArray(payload.requiredMediaTypes) ? payload.requiredMediaTypes : [];
  return requiredMediaTypes.some((item) => String(item ?? "").trim().toLowerCase() === "image");
}
