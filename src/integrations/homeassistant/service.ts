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
    if (op === "call_service") {
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

    if (op === "get_state") {
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

    if (op === "camera_snapshot") {
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

    return { ok: false, error: `Unsupported op: ${op ?? "unknown"}` };
  }
}
