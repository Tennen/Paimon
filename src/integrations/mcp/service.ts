export type McpJsonRpcId = string | number;
export type McpJsonRpcParams = Record<string, unknown> | unknown[];

export type McpCallResult = {
  endpoint: string;
  method: string;
  id: McpJsonRpcId;
  ok: boolean;
  result?: unknown;
  error?: { code?: number; message: string; data?: unknown };
};

export type McpFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type McpServiceConfig = { endpoint?: string; timeoutMs?: number; fetchImpl?: McpFetch };

const DEFAULT_TIMEOUT_MS = 15_000;
const defaultFetch: McpFetch = async (input, init) => fetch(input, init);

export class McpService {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: McpFetch;
  private requestId = 0;

  constructor(config: McpServiceConfig = {}) {
    this.endpoint = resolveEndpoint(config.endpoint);
    this.timeoutMs = resolveTimeoutMs(config.timeoutMs);
    this.fetchImpl = config.fetchImpl ?? defaultFetch;
  }

  async call(method: string, params: McpJsonRpcParams = {}): Promise<McpCallResult> {
    const normalizedMethod = String(method ?? "").trim();
    const id = ++this.requestId;
    if (!this.endpoint) return errorResult("", normalizedMethod, id, "MCP endpoint is not configured");
    if (!normalizedMethod) return errorResult(this.endpoint, "", id, "Missing method");

    const controller =
      typeof AbortController === "undefined" || this.timeoutMs <= 0 ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: normalizedMethod, params }),
        ...(controller ? { signal: controller.signal } : {})
      });
      const body = await response.text();
      const payload = parsePayload(body);

      if (!response.ok) {
        return errorResult(this.endpoint, normalizedMethod, id, `MCP request failed with HTTP ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          body: truncate(body)
        });
      }

      if (!payload || payload.jsonrpc !== "2.0" || (!("result" in payload) && !("error" in payload))) {
        return errorResult(this.endpoint, normalizedMethod, id, "Invalid JSON-RPC response from MCP endpoint", {
          body: truncate(body)
        });
      }

      if ("error" in payload) {
        const rpcError = payload.error;
        if (!isRecord(rpcError) || typeof rpcError.message !== "string") {
          return errorResult(this.endpoint, normalizedMethod, id, "Invalid JSON-RPC error from MCP endpoint", {
            response: payload
          });
        }
        return {
          endpoint: this.endpoint,
          method: normalizedMethod,
          id,
          ok: false,
          error: {
            ...(typeof rpcError.code === "number" ? { code: rpcError.code } : {}),
            message: rpcError.message,
            ...("data" in rpcError ? { data: rpcError.data } : {})
          }
        };
      }

      return { endpoint: this.endpoint, method: normalizedMethod, id, ok: true, result: payload.result };
    } catch (error) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || /aborted|abort|timeout/i.test(error.message));
      const message = isAbort ? `MCP request timeout after ${this.timeoutMs}ms` : (error as Error)?.message ?? "MCP request failed";
      return errorResult(this.endpoint, normalizedMethod, id, message);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function resolveEndpoint(endpoint?: string): string {
  if (typeof endpoint === "string") return endpoint.trim();
  return String(process.env.MCP_ENDPOINT ?? "").trim();
}

function resolveTimeoutMs(timeoutMs?: number): number {
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.floor(timeoutMs);
  }
  const envTimeoutMs = Number.parseInt(String(process.env.MCP_TIMEOUT_MS ?? ""), 10);
  return Number.isFinite(envTimeoutMs) && envTimeoutMs > 0 ? envTimeoutMs : DEFAULT_TIMEOUT_MS;
}

function parsePayload(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function errorResult(
  endpoint: string,
  method: string,
  id: McpJsonRpcId,
  message: string,
  data?: unknown
): McpCallResult {
  return { endpoint, method, id, ok: false, error: { message, ...(data === undefined ? {} : { data }) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(input: string, max = 400): string {
  return input.length > max ? `${input.slice(0, max)}...` : input;
}
