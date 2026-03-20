import { fetch } from "undici";

const DEFAULT_WECOM_API_BASE_URL = "https://qyapi.weixin.qq.com";

type TokenCache = {
  value: string;
  expiresAt: number;
};

type WeComApiResponse = {
  errcode?: number;
  errmsg?: string;
};

type TokenResponse = WeComApiResponse & {
  access_token?: string;
  expires_in?: number;
};

export type WeComMenuPublishLeafButton = {
  type: "click";
  name: string;
  key: string;
};

export type WeComMenuPublishGroupButton = {
  name: string;
  sub_button: WeComMenuPublishLeafButton[];
};

export type WeComMenuPublishButton = WeComMenuPublishLeafButton | WeComMenuPublishGroupButton;

export type WeComMenuPublishPayload = {
  button: WeComMenuPublishButton[];
};

export type WeComMenuClientConfig = {
  corpId: string;
  appSecret: string;
  agentId: string;
  apiBaseUrl: string;
};

export class WeComMenuClient {
  private readonly config: WeComMenuClientConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config?: Partial<WeComMenuClientConfig>) {
    this.config = {
      corpId: config?.corpId ?? process.env.WECOM_CORP_ID ?? "",
      appSecret: config?.appSecret ?? process.env.WECOM_APP_SECRET ?? "",
      agentId: config?.agentId ?? process.env.WECOM_AGENT_ID ?? "",
      apiBaseUrl: normalizeBaseUrl(config?.apiBaseUrl ?? process.env.WECOM_API_BASE_URL ?? DEFAULT_WECOM_API_BASE_URL)
    };
  }

  async createMenu(payload: WeComMenuPublishPayload): Promise<void> {
    const token = await this.getToken();
    const url = `${this.config.apiBaseUrl}/cgi-bin/menu/create?access_token=${encodeURIComponent(token)}&agentid=${encodeURIComponent(this.config.agentId)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`wecom menu create http ${response.status}`);
    }

    const data = (await response.json()) as WeComApiResponse;
    if ((data.errcode ?? 0) !== 0) {
      throw new Error(`wecom menu create error ${data.errcode ?? "unknown"}: ${data.errmsg ?? ""}`);
    }
  }

  private async getToken(): Promise<string> {
    if (!this.config.corpId || !this.config.appSecret || !this.config.agentId) {
      throw new Error("WECOM_CORP_ID/WECOM_APP_SECRET/WECOM_AGENT_ID missing");
    }

    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 5000) {
      return this.tokenCache.value;
    }

    const url = `${this.config.apiBaseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(this.config.corpId)}&corpsecret=${encodeURIComponent(this.config.appSecret)}`;
    const response = await fetch(url, {
      method: "GET"
    });

    if (!response.ok) {
      throw new Error(`wecom gettoken http ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
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
}

function normalizeBaseUrl(raw: string): string {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    return DEFAULT_WECOM_API_BASE_URL;
  }
  return normalized.replace(/\/+$/, "");
}
