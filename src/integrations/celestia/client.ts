import { fetch } from "undici";

export type CelestiaRequestQuery = Record<string, string | number | boolean | undefined>;

export class CelestiaClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl ?? process.env.CELESTIA_BASE_URL ?? "";
    this.token = token ?? process.env.CELESTIA_TOKEN ?? "";
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    options: {
      body?: Record<string, unknown>;
      query?: CelestiaRequestQuery;
    } = {}
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error("CELESTIA_BASE_URL or CELESTIA_TOKEN missing");
    }

    const url = buildUrl(this.baseUrl, path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const raw = await res.text();
    if (!res.ok) {
      const detail = normalizeErrorDetail(raw);
      throw new Error(detail ? `Celestia error ${res.status}: ${detail}` : `Celestia error ${res.status}`);
    }

    if (!raw.trim()) {
      return undefined as T;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }
}

function buildUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const normalizedBasePath = base.pathname.replace(/\/$/, "");
  const normalizedPath = String(path ?? "").startsWith("/") ? String(path) : `/${String(path ?? "")}`;
  base.pathname = `${normalizedBasePath}${normalizedPath}`.replace(/\/{2,}/g, "/");
  base.search = "";
  base.hash = "";
  return base;
}

function normalizeErrorDetail(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const candidates = [
      parsed.error,
      parsed.message,
      parsed.detail
    ].filter((value) => typeof value === "string" && value.trim());
    if (candidates.length > 0) {
      return String(candidates[0]).trim();
    }
  } catch {
    // fall through to raw text
  }

  return text.replace(/\s+/g, " ").slice(0, 200);
}
