import fs from "fs/promises";
import path from "path";
import { URLSearchParams } from "url";
import { fetch } from "undici";

type TokenCache = {
  value: string;
  expiresAt: number;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type BridgeMediaResponse = {
  base64?: string;
  filename?: string;
  content_type?: string;
  errcode?: number;
  errmsg?: string;
};

type BinaryMediaPayload = {
  data: Buffer;
  filename?: string;
  contentType?: string;
};

export type WeComMediaDownloaderConfig = {
  corpId: string;
  appSecret: string;
  bridgeUrl: string;
  bridgeToken: string;
  audioDir: string;
  useBridge: boolean;
};

export class WeComMediaDownloader {
  private readonly config: WeComMediaDownloaderConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config?: Partial<WeComMediaDownloaderConfig>) {
    this.config = {
      corpId: config?.corpId ?? process.env.WECOM_CORP_ID ?? "",
      appSecret: config?.appSecret ?? process.env.WECOM_APP_SECRET ?? "",
      bridgeUrl: config?.bridgeUrl ?? process.env.WECOM_BRIDGE_URL ?? "",
      bridgeToken: config?.bridgeToken ?? process.env.WECOM_BRIDGE_TOKEN ?? "",
      audioDir: config?.audioDir ?? process.env.WECOM_AUDIO_DIR ?? "data/wecom-audio",
      useBridge: config?.useBridge ?? parseBoolean(process.env.WECOM_MEDIA_USE_BRIDGE, true)
    };
  }

  async downloadVoice(mediaId: string, messageId?: string): Promise<string> {
    const normalizedMediaId = mediaId.trim();
    if (!normalizedMediaId) {
      throw new Error("missing mediaId");
    }

    const token = await this.getToken();
    const media = await this.fetchVoiceMedia(token, normalizedMediaId);

    const day = new Date().toISOString().slice(0, 10);
    const targetDir = path.resolve(process.cwd(), this.config.audioDir, day);
    await fs.mkdir(targetDir, { recursive: true });

    const ext = inferExtension(media.filename, media.contentType, "amr");
    const namePart = sanitizeFilenamePart(messageId || `${Date.now()}`);
    const mediaPart = sanitizeFilenamePart(normalizedMediaId).slice(0, 48);
    const filename = `${namePart}-${mediaPart}.${ext}`;
    const filePath = path.join(targetDir, filename);
    await fs.writeFile(filePath, media.data);
    return filePath;
  }

  private async getToken(): Promise<string> {
    if (!this.config.corpId || !this.config.appSecret) {
      throw new Error("WECOM_CORP_ID/WECOM_APP_SECRET missing");
    }

    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 5000) {
      return this.tokenCache.value;
    }

    const data = this.shouldUseBridge()
      ? await this.getTokenViaBridge()
      : await this.getTokenDirect();

    if (!data.access_token) {
      throw new Error(`wecom gettoken error ${data.errcode ?? "unknown"}: ${data.errmsg ?? ""}`);
    }

    const ttlMs = (data.expires_in ?? 7200) * 1000;
    this.tokenCache = {
      value: data.access_token,
      expiresAt: now + ttlMs
    };
    return data.access_token;
  }

  private async getTokenViaBridge(): Promise<TokenResponse> {
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

    return (await res.json()) as TokenResponse;
  }

  private async getTokenDirect(): Promise<TokenResponse> {
    const qs = new URLSearchParams({
      corpid: this.config.corpId,
      corpsecret: this.config.appSecret
    });
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?${qs.toString()}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`wecom gettoken http ${res.status}`);
    }
    return (await res.json()) as TokenResponse;
  }

  private async fetchVoiceMedia(accessToken: string, mediaId: string): Promise<BinaryMediaPayload> {
    if (this.shouldUseBridge()) {
      try {
        return await this.fetchVoiceMediaViaBridge(accessToken, mediaId);
      } catch (error) {
        console.warn(`[wecom-media] bridge media fetch failed, fallback to direct: ${(error as Error).message}`);
      }
    }
    return this.fetchVoiceMediaDirect(accessToken, mediaId);
  }

  private async fetchVoiceMediaViaBridge(accessToken: string, mediaId: string): Promise<BinaryMediaPayload> {
    const url = this.config.bridgeUrl.replace(/\/$/, "") + "/proxy/media/get";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.bridgeToken ? { Authorization: `Bearer ${this.config.bridgeToken}` } : {})
      },
      body: JSON.stringify({
        access_token: accessToken,
        media_id: mediaId
      })
    });

    if (!res.ok) {
      throw new Error(`wecom bridge media get http ${res.status}`);
    }

    const data = (await res.json()) as BridgeMediaResponse;
    if (!data.base64) {
      throw new Error(`wecom bridge media get error ${data.errcode ?? "unknown"}: ${data.errmsg ?? ""}`);
    }

    return {
      data: Buffer.from(data.base64, "base64"),
      filename: data.filename,
      contentType: data.content_type
    };
  }

  private async fetchVoiceMediaDirect(accessToken: string, mediaId: string): Promise<BinaryMediaPayload> {
    const qs = new URLSearchParams({
      access_token: accessToken,
      media_id: mediaId
    });
    const url = `https://qyapi.weixin.qq.com/cgi-bin/media/get?${qs.toString()}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`wecom media get http ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? undefined;
    if (contentType && contentType.includes("application/json")) {
      const data = (await res.json()) as { errcode?: number; errmsg?: string };
      throw new Error(`wecom media get error ${data.errcode ?? "unknown"}: ${data.errmsg ?? ""}`);
    }

    const filename = parseFilenameFromDisposition(res.headers.get("content-disposition"));
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      data: buffer,
      filename,
      contentType
    };
  }

  private shouldUseBridge(): boolean {
    return this.config.useBridge && this.config.bridgeUrl.trim().length > 0;
  }
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) {
    return fallback;
  }
  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseFilenameFromDisposition(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^\";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return undefined;
}

function inferExtension(filename: string | undefined, contentType: string | undefined, fallback: string): string {
  const fromFilename = filename?.match(/\.([A-Za-z0-9]+)$/)?.[1];
  if (fromFilename) {
    return sanitizeExtension(fromFilename);
  }

  const normalizedType = (contentType ?? "").toLowerCase();
  if (normalizedType.includes("audio/amr")) return "amr";
  if (normalizedType.includes("audio/mpeg")) return "mp3";
  if (normalizedType.includes("audio/mp4")) return "m4a";
  if (normalizedType.includes("audio/wav")) return "wav";
  if (normalizedType.includes("audio/x-wav")) return "wav";
  if (normalizedType.includes("audio/ogg")) return "ogg";
  if (normalizedType.includes("audio/webm")) return "webm";
  return sanitizeExtension(fallback);
}

function sanitizeExtension(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized || "dat";
}

function sanitizeFilenamePart(input: string): string {
  const normalized = input.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized || "media";
}
