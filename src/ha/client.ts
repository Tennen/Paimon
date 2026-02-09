import { fetch } from "undici";

export class HAClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = process.env.HA_BASE_URL ?? "";
    this.token = process.env.HA_TOKEN ?? "";
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  getWebSocketUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = url.pathname.replace(/\/$/, "") + "/api/websocket";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async requestJson(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new Error("HA_BASE_URL or HA_TOKEN missing");
    }

    const url = new URL(path, this.baseUrl.replace(/\/$/, "/"));
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      throw new Error(`HA error ${res.status}`);
    }

    return await res.json();
  }

  async requestBinary(path: string): Promise<{ buffer: Buffer; contentType: string } > {
    if (!this.isConfigured()) {
      throw new Error("HA_BASE_URL or HA_TOKEN missing");
    }

    const url = new URL(path, this.baseUrl.replace(/\/$/, "/"));
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`
      }
    });

    if (!res.ok) {
      throw new Error(`HA error ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return { buffer, contentType };
  }

  getToken(): string {
    return this.token;
  }
}
