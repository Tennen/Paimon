import { Action, ToolResult } from "../types";
import { Config } from "../config";

export class HomeAssistantTool {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly config: Config;

  constructor(config: Config) {
    this.baseUrl = process.env.HA_BASE_URL ?? "";
    this.token = process.env.HA_TOKEN ?? "";
    this.config = config;
  }

  async execute(action: Action): Promise<ToolResult> {
    if (!this.baseUrl || !this.token) {
      return { ok: false, error: "HA_BASE_URL or HA_TOKEN missing" };
    }

    if (action.type === "ha.call_service") {
      const domain = action.params.domain as string;
      const service = action.params.service as string;
      const entityId = action.params.entity_id as string | string[] | undefined;
      const data = (action.params.data as Record<string, unknown>) ?? {};

      if (!domain || !service || !entityId) {
        return { ok: false, error: "Missing domain/service/entity_id" };
      }

      const entities = Array.isArray(entityId) ? entityId : [entityId];
      const denied = entities.find((id) => !isEntityAllowed(id, this.config));
      if (denied) {
        return { ok: false, error: `Entity not allowed: ${denied}` };
      }

      const url = `${this.baseUrl.replace(/\/$/, "")}/api/services/${domain}/${service}`;
      const body = {
        entity_id: entityId,
        ...data
      };

      return await this.postJson(url, body);
    }

    if (action.type === "ha.get_state") {
      const entityId = action.params.entity_id as string | undefined;
      if (!entityId) {
        return { ok: false, error: "Missing entity_id" };
      }

      if (!isEntityAllowed(entityId, this.config)) {
        return { ok: false, error: `Entity not allowed: ${entityId}` };
      }

      const url = `${this.baseUrl.replace(/\/$/, "")}/api/states/${entityId}`;
      return await this.getJson(url);
    }

    return { ok: false, error: `Unsupported action: ${action.type}` };
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<ToolResult> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      return { ok: false, error: `HA error ${res.status}` };
    }

    const output = await res.json();
    return { ok: true, output };
  }

  private async getJson(url: string): Promise<ToolResult> {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`
      }
    });

    if (!res.ok) {
      return { ok: false, error: `HA error ${res.status}` };
    }

    const output = await res.json();
    return { ok: true, output };
  }
}

function isEntityAllowed(entityId: string, config: Config): boolean {
  const allowlist = config.haEntityAllowlist ?? [];
  const prefixes = config.haEntityAllowlistPrefixes ?? [];

  if (allowlist.length === 0 && prefixes.length === 0) {
    return false;
  }

  if (allowlist.includes(entityId)) {
    return true;
  }

  return prefixes.some((prefix) => entityId.startsWith(prefix));
}
