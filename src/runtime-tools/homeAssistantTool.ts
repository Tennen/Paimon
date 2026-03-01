import { ToolResult } from "../types";
import { HAClient } from "../integrations/ha/client";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";
import { HAEntityRegistry } from "../integrations/ha/entityRegistry";

export type HaEntityChecker = (entityId: string) => boolean;

export class HomeAssistantTool {
  private readonly client: HAClient;
  private readonly isEntityAllowed: HaEntityChecker;

  constructor(client: HAClient, isEntityAllowed: HaEntityChecker) {
    this.client = client;
    this.isEntityAllowed = isEntityAllowed;
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
      const denied = entities.find((id) => !this.isEntityAllowed(id));
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
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    if (op === "get_state") {
      const entityId = args.entity_id as string | undefined;
      if (!entityId) {
        return { ok: false, error: "Missing entity_id" };
      }

      if (!this.isEntityAllowed(entityId)) {
        return { ok: false, error: `Entity not allowed: ${entityId}` };
      }

      try {
        const output = await this.client.requestJson("GET", `/api/states/${entityId}`);
        return { ok: true, output: { data: output, meta: { ha_action: "get_state", entity_id: entityId } } };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    if (op === "camera_snapshot") {
      const entityId = args.entity_id as string | undefined;
      if (!entityId) {
        return { ok: false, error: "Missing entity_id" };
      }

      if (!this.isEntityAllowed(entityId)) {
        return { ok: false, error: `Entity not allowed: ${entityId}` };
      }

      try {
        const { buffer, contentType } = await this.client.requestBinary(`/api/camera_proxy/${entityId}`);
        const ext = contentType.includes("png") ? "png" : "jpg";
        const output = {
          image: {
            data: buffer.toString("base64"),
            contentType,
            filename: `${entityId.replace(".", "_")}.${ext}`
          },
          meta: { ha_action: "camera_snapshot", entity_id: entityId }
        };
        return { ok: true, output };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    return { ok: false, error: `Unsupported op: ${op ?? "unknown"}` };
  }
}

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const haClient = new HAClient();
  const haRegistry = new HAEntityRegistry(haClient);
  haRegistry.start();
  const tool = new HomeAssistantTool(haClient, (entityId) => haRegistry.has(entityId));

  registry.register(
    {
      name: "homeassistant",
      execute: (op, args, _context) => tool.execute(op, args),
      runtimeContext: () => ({ entities: haRegistry.getEntityInfo() })
    },
    {
      name: "homeassistant",
      description: "Control Home Assistant devices and query their state.",
      resource: "entities",
      keywords: [
        "home assistant",
        "ha",
        "smart home",
        "home automation",
        "device",
        "devices",
        "light",
        "lights",
        "switch",
        "sensor",
        "camera",
        "thermostat",
        "设备",
        "灯",
        "开关",
        "温度",
        "摄像头"
      ],
      operations: [
        {
          op: "call_service",
          description: "Call a Home Assistant service for one or more entities.",
          params: {
            domain: "string",
            service: "string",
            entity_id: "string | string[]",
            data: "object?"
          },
          param_descriptions: {
            domain: "Service domain, such as light/switch/climate.",
            service: "Service name in the domain, such as turn_on/turn_off.",
            entity_id: "Target entity id or a list of entity ids.",
            data: "Optional extra service data."
          }
        },
        {
          op: "get_state",
          description: "Fetch current state for a single entity.",
          params: {
            entity_id: "string"
          },
          param_descriptions: {
            entity_id: "Target entity id."
          }
        },
        {
          op: "camera_snapshot",
          description: "Capture a camera snapshot and return image data.",
          params: {
            entity_id: "string"
          },
          param_descriptions: {
            entity_id: "Camera entity id."
          }
        }
      ]
    }
  );
}
