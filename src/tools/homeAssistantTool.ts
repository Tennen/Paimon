import { Action, ToolResult } from "../types";
import { HAClient } from "../ha/client";
import { describeImage } from "../engines/llm/ollama/vision";

export type HaEntityChecker = (entityId: string) => boolean;

export class HomeAssistantTool {
  private readonly client: HAClient;
  private readonly isEntityAllowed: HaEntityChecker;
  private readonly describeSnapshots: boolean;

  constructor(client: HAClient, isEntityAllowed: HaEntityChecker) {
    this.client = client;
    this.isEntityAllowed = isEntityAllowed;
    this.describeSnapshots = (process.env.HA_SNAPSHOT_DESCRIBE ?? "true") === "true";
  }

  async execute(action: Action): Promise<ToolResult> {
    if (action.type === "ha.call_service") {
      const domain = action.params.domain as string;
      const service = action.params.service as string;
      const entityId = action.params.entity_id as string | string[] | undefined;
      const data = (action.params.data as Record<string, unknown>) ?? {};

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
        return { ok: true, output };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    if (action.type === "ha.get_state") {
      const entityId = action.params.entity_id as string | undefined;
      if (!entityId) {
        return { ok: false, error: "Missing entity_id" };
      }

      if (!this.isEntityAllowed(entityId)) {
        return { ok: false, error: `Entity not allowed: ${entityId}` };
      }

      try {
        const output = await this.client.requestJson("GET", `/api/states/${entityId}`);
        return { ok: true, output };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    if (action.type === "ha.camera_snapshot") {
      const entityId = action.params.entity_id as string | undefined;
      if (!entityId) {
        return { ok: false, error: "Missing entity_id" };
      }

      if (!this.isEntityAllowed(entityId)) {
        return { ok: false, error: `Entity not allowed: ${entityId}` };
      }

      try {
        const { buffer, contentType } = await this.client.requestBinary(`/api/camera_proxy/${entityId}`);
        const ext = contentType.includes("png") ? "png" : "jpg";
        const output: {
          image: { data: string; contentType: string; filename: string };
          caption?: string;
        } = {
          image: {
            data: buffer.toString("base64"),
            contentType,
            filename: `${entityId.replace(".", "_")}.${ext}`
          }
        };

        if (this.describeSnapshots) {
          try {
            const caption = await describeImage(output.image.data);
            if (caption) {
              output.caption = caption;
            }
          } catch (err) {
            console.warn("[ha.camera_snapshot] describe failed:", (err as Error).message);
          }
        }

        return { ok: true, output };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    return { ok: false, error: `Unsupported action: ${action.type}` };
  }
}
