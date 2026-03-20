import { HAClient } from "./client";
import { HAEntityRegistry } from "./entityRegistry";
import { ToolResult } from "../../types";

export class HomeAssistantToolService {
  private readonly client: HAClient;
  private readonly registry: HAEntityRegistry;

  constructor(client?: HAClient, registry?: HAEntityRegistry) {
    this.client = client ?? new HAClient();
    this.registry = registry ?? new HAEntityRegistry(this.client);
  }

  start(): void {
    this.registry.start();
  }

  getRuntimeContext(): { entities: ReturnType<HAEntityRegistry["getEntityInfo"]> } {
    return {
      entities: this.registry.getEntityInfo()
    };
  }

  async execute(op: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (op === "direct_command") {
      return this.executeDirectCommand(args);
    }

    if (op === "call_service") {
      return this.callService(args);
    }

    if (op === "get_state") {
      return this.getState(args);
    }

    if (op === "camera_snapshot") {
      return this.cameraSnapshot(args);
    }

    return { ok: false, error: `Unsupported op: ${op ?? "unknown"}` };
  }

  private async executeDirectCommand(args: Record<string, unknown>): Promise<ToolResult> {
    const input = String(args.input ?? "").trim();
    if (!input) {
      return {
        ok: false,
        error: "Missing direct command input. Usage: /ha call_service <service|domain.service> <friendly_name|entity_id> | /ha camera_snapshot <entity_id|friendly_name>"
      };
    }

    const parsed = parseDirectHomeAssistantCommand(input);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    if (parsed.command === "call_service") {
      const resolved = this.registry.resolveEntityReference(parsed.target);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }

      const entityId = resolved.entity.entity_id;
      const resolvedDomain = parsed.domain || resolved.entity.domain || entityId.split(".")[0] || "";
      if (!resolvedDomain) {
        return { ok: false, error: `Unable to resolve domain for ${entityId}` };
      }

      const result = await this.callService({
        domain: resolvedDomain,
        service: parsed.service,
        entity_id: entityId
      });
      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        output: {
          text: `已调用 ${resolvedDomain}.${parsed.service} -> ${resolved.entity.name || entityId} (${entityId})`,
          ...(result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {})
        }
      };
    }

    if (parsed.command === "camera_snapshot") {
      const resolved = this.registry.resolveEntityReference(parsed.target, { preferredDomain: "camera" });
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }

      const result = await this.cameraSnapshot({
        entity_id: resolved.entity.entity_id
      });
      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        output: {
          text: `已抓取摄像头快照：${resolved.entity.name || resolved.entity.entity_id} (${resolved.entity.entity_id})`,
          ...(result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {})
        }
      };
    }

    const resolved = this.registry.resolveEntityReference(parsed.target);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const result = await this.getState({
      entity_id: resolved.entity.entity_id
    });
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      output: {
        text: `已获取状态：${resolved.entity.name || resolved.entity.entity_id} (${resolved.entity.entity_id})`,
        ...(result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {})
      }
    };
  }

  private async callService(args: Record<string, unknown>): Promise<ToolResult> {
    const domain = args.domain as string;
    const service = args.service as string;
    const entityId = args.entity_id as string | string[] | undefined;
    const data = (args.data as Record<string, unknown>) ?? {};

    if (!domain || !service || !entityId) {
      return { ok: false, error: "Missing domain/service/entity_id" };
    }

    const entities = Array.isArray(entityId) ? entityId : [entityId];
    const denied = entities.find((id) => !this.registry.has(id));
    if (denied) {
      return { ok: false, error: `Entity not allowed: ${denied}` };
    }

    const body = {
      entity_id: entityId,
      ...data
    };

    try {
      const output = await this.client.requestJson("POST", `/api/services/${domain}/${service}`, body);
      return { ok: true, output: { data: output, meta: { ha_action: "call_service", entity_id: entityId } } };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async getState(args: Record<string, unknown>): Promise<ToolResult> {
    const entityId = args.entity_id as string | undefined;
    if (!entityId) {
      return { ok: false, error: "Missing entity_id" };
    }

    if (!this.registry.has(entityId)) {
      return { ok: false, error: `Entity not allowed: ${entityId}` };
    }

    try {
      const output = await this.client.requestJson("GET", `/api/states/${entityId}`);
      return { ok: true, output: { data: output, meta: { ha_action: "get_state", entity_id: entityId } } };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async cameraSnapshot(args: Record<string, unknown>): Promise<ToolResult> {
    const entityId = args.entity_id as string | undefined;
    if (!entityId) {
      return { ok: false, error: "Missing entity_id" };
    }

    if (!this.registry.has(entityId)) {
      return { ok: false, error: `Entity not allowed: ${entityId}` };
    }

    try {
      const { buffer, contentType } = await this.client.requestBinary(`/api/camera_proxy/${entityId}`);
      const ext = contentType.includes("png") ? "png" : "jpg";
      return {
        ok: true,
        output: {
          image: {
            data: buffer.toString("base64"),
            contentType,
            filename: `${entityId.replace(".", "_")}.${ext}`
          },
          meta: { ha_action: "camera_snapshot", entity_id: entityId }
        }
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}

type ParsedDirectHomeAssistantCommand =
  | {
      ok: true;
      command: "call_service";
      service: string;
      domain: string;
      target: string;
    }
  | {
      ok: true;
      command: "camera_snapshot" | "get_state";
      target: string;
    }
  | {
      ok: false;
      error: string;
    };

function parseDirectHomeAssistantCommand(input: string): ParsedDirectHomeAssistantCommand {
  const trimmed = String(input ?? "").trim();
  const firstSpace = trimmed.indexOf(" ");
  const command = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).trim().toLowerCase();
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  if (command === "call_service") {
    const serviceSpace = rest.indexOf(" ");
    const serviceToken = serviceSpace === -1 ? rest : rest.slice(0, serviceSpace).trim();
    const target = serviceSpace === -1 ? "" : rest.slice(serviceSpace + 1).trim();
    if (!serviceToken || !target) {
      return {
        ok: false,
        error: "Usage: /ha call_service <service|domain.service> <friendly_name|entity_id>"
      };
    }

    const { domain, service } = parseServiceToken(serviceToken);
    if (!service) {
      return {
        ok: false,
        error: `Invalid service: ${serviceToken}`
      };
    }

    return {
      ok: true,
      command: "call_service",
      domain,
      service,
      target
    };
  }

  if (command === "camera_snapshot" || command === "get_state") {
    if (!rest) {
      return {
        ok: false,
        error: `Usage: /ha ${command} <friendly_name|entity_id>`
      };
    }

    return {
      ok: true,
      command,
      target: rest
    };
  }

  return {
    ok: false,
    error: "Unsupported /ha command. Supported: call_service, get_state, camera_snapshot"
  };
}

function parseServiceToken(token: string): { domain: string; service: string } {
  const raw = String(token ?? "").trim().toLowerCase();
  if (!raw) {
    return { domain: "", service: "" };
  }
  const parts = raw.split(".");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return {
      domain: parts[0],
      service: parts[1]
    };
  }
  return {
    domain: "",
    service: raw
  };
}
