import { fetch } from "undici";

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
  bridgeUrl: string;
  bridgeToken: string;
};

export class WeComMenuClient {
  private readonly config: WeComMenuClientConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config?: Partial<WeComMenuClientConfig>) {
    this.config = {
      corpId: config?.corpId ?? process.env.WECOM_CORP_ID ?? "",
      appSecret: config?.appSecret ?? process.env.WECOM_APP_SECRET ?? "",
      agentId: config?.agentId ?? process.env.WECOM_AGENT_ID ?? "",
      bridgeUrl: normalizeBridgeUrl(config?.bridgeUrl ?? process.env.WECOM_BRIDGE_URL ?? ""),
      bridgeToken: config?.bridgeToken ?? process.env.WECOM_BRIDGE_TOKEN ?? ""
    };
  }

  async createMenu(payload: WeComMenuPublishPayload): Promise<void> {
    if (!this.config.bridgeUrl) {
      throw new Error("WECOM_BRIDGE_URL missing for menu publish");
    }

    const token = await this.getToken();
    const url = this.config.bridgeUrl.replace(/\/$/, "") + "/proxy/menu/create";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.bridgeToken ? { Authorization: `Bearer ${this.config.bridgeToken}` } : {})
      },
      body: JSON.stringify({
        access_token: token,
        agentid: this.config.agentId,
        menu: payload
      })
    });

    if (!response.ok) {
      throw new Error(`wecom bridge menu create http ${response.status}`);
    }

    const data = (await response.json()) as WeComApiResponse;
    if ((data.errcode ?? 0) !== 0) {
      throw new Error(`wecom bridge menu create error ${data.errcode ?? "unknown"}: ${data.errmsg ?? ""}`);
    }
  }

  private async getToken(): Promise<string> {
    if (!this.config.corpId || !this.config.appSecret || !this.config.agentId) {
      throw new Error("WECOM_CORP_ID/WECOM_APP_SECRET/WECOM_AGENT_ID missing");
    }
    if (!this.config.bridgeUrl) {
      throw new Error("WECOM_BRIDGE_URL missing for menu publish");
    }

    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 5000) {
      return this.tokenCache.value;
    }

    const url = this.config.bridgeUrl.replace(/\/$/, "") + "/proxy/gettoken";
    const response = await fetch(url, {
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

    if (!response.ok) {
      throw new Error(`wecom bridge gettoken http ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
    if (!data.access_token) {
      throw new Error(`wecom bridge gettoken error ${data.errcode ?? "unknown"}: ${data.errmsg ?? ""}`);
    }

    const ttlMs = (data.expires_in ?? 7200) * 1000;
    this.tokenCache = {
      value: data.access_token,
      expiresAt: now + ttlMs
    };
    return data.access_token;
  }
}

function normalizeBridgeUrl(raw: string): string {
  const normalized = String(raw ?? "").trim();
  return normalized.replace(/\/+$/, "");
}
