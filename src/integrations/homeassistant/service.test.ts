import assert from "node:assert/strict";
import test from "node:test";
import { HomeAssistantToolService } from "./service";

test("direct /ha call_service resolves friendly name to entity id and domain", async () => {
  const client = {
    requestJson: async (method: string, path: string, body?: Record<string, unknown>) => ({
      method,
      path,
      body
    })
  };
  const registry = {
    start: () => {},
    getEntityInfo: () => [],
    has: (entityId: string) => entityId === "light.living_room_main",
    resolveEntityReference: (reference: string) => {
      if (reference === "客厅主灯") {
        return {
          ok: true as const,
          entity: {
            entity_id: "light.living_room_main",
            name: "客厅主灯",
            domain: "light"
          }
        };
      }
      return {
        ok: false as const,
        error: `Entity not found: ${reference}`
      };
    }
  };
  const service = new HomeAssistantToolService(client as any, registry as any);

  const result = await service.execute("direct_command", {
    input: "call_service turn_on 客厅主灯"
  });

  assert.equal(result.ok, true);
  assert.equal((result.output as { text?: string })?.text, "已调用 light.turn_on -> 客厅主灯 (light.living_room_main)");
  assert.deepEqual((result.output as { data?: unknown })?.data, {
    method: "POST",
    path: "/api/services/light/turn_on",
    body: {
      entity_id: "light.living_room_main"
    }
  });
});

test("direct /ha camera_snapshot accepts entity id or friendly name", async () => {
  const client = {
    requestBinary: async () => ({
      buffer: Buffer.from("fake-image"),
      contentType: "image/jpeg"
    })
  };
  const registry = {
    start: () => {},
    getEntityInfo: () => [],
    has: (entityId: string) => entityId === "camera.entryway",
    resolveEntityReference: (reference: string, options?: { preferredDomain?: string }) => {
      if (reference === "入户摄像头" && options?.preferredDomain === "camera") {
        return {
          ok: true as const,
          entity: {
            entity_id: "camera.entryway",
            name: "入户摄像头",
            domain: "camera"
          }
        };
      }
      return {
        ok: false as const,
        error: `Entity not found: ${reference}`
      };
    }
  };
  const service = new HomeAssistantToolService(client as any, registry as any);

  const result = await service.execute("direct_command", {
    input: "camera_snapshot 入户摄像头"
  });

  assert.equal(result.ok, true);
  assert.equal((result.output as { text?: string })?.text, "已抓取摄像头快照：入户摄像头 (camera.entryway)");
  assert.equal((result.output as { image?: { filename?: string } })?.image?.filename, "camera_entryway.jpg");
});
