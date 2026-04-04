import assert from "node:assert/strict";
import test from "node:test";
import { CelestiaToolService } from "./service";

test("direct /celestia call forwards semantic target and JSON params", async () => {
  const client = {
    requestJson: async (method: string, path: string, options?: { body?: Record<string, unknown> }) => ({
      method,
      path,
      body: options?.body
    })
  };
  const catalog = {
    start: () => {},
    getDevices: () => [],
    refreshNow: async () => [],
    hasDevice: () => false
  };

  const service = new CelestiaToolService(client as any, catalog as any);
  const result = await service.execute("direct_command", {
    input: 'call Kitchen Feeder.Feed Once | {"portions":2}'
  });

  assert.equal(result.ok, true);
  assert.equal((result.output as { text?: string })?.text, "已执行 Celestia 指令：Kitchen Feeder.Feed Once");
  assert.deepEqual((result.output as { data?: unknown })?.data, {
    method: "POST",
    path: "/api/ai/v1/commands",
    body: {
      target: "Kitchen Feeder.Feed Once",
      params: {
        portions: 2
      }
    }
  });
});

test("direct /celestia raw validates device id and forwards raw action params", async () => {
  const client = {
    requestJson: async (method: string, path: string, options?: { body?: Record<string, unknown> }) => ({
      method,
      path,
      body: options?.body
    })
  };
  const catalog = {
    start: () => {},
    getDevices: () => [{ id: "petkit:feeder:pet-parent" }],
    refreshNow: async () => [],
    hasDevice: (deviceId: string) => deviceId === "petkit:feeder:pet-parent"
  };

  const service = new CelestiaToolService(client as any, catalog as any);
  const result = await service.execute("direct_command", {
    input: 'raw petkit:feeder:pet-parent manual_feed_dual | {"amount1":20,"amount2":20}'
  });

  assert.equal(result.ok, true);
  assert.equal((result.output as { text?: string })?.text, "已执行 Celestia 原始动作：petkit:feeder:pet-parent.manual_feed_dual");
  assert.deepEqual((result.output as { data?: unknown })?.data, {
    method: "POST",
    path: "/api/ai/v1/commands",
    body: {
      device_id: "petkit:feeder:pet-parent",
      action: "manual_feed_dual",
      params: {
        amount1: 20,
        amount2: 20
      }
    }
  });
});

test("invoke_command rejects raw device ids that are missing from the loaded catalog", async () => {
  const client = {
    requestJson: async () => {
      throw new Error("should not be called");
    }
  };
  const catalog = {
    start: () => {},
    getDevices: () => [{ id: "petkit:feeder:pet-parent" }],
    refreshNow: async () => [],
    hasDevice: () => false
  };

  const service = new CelestiaToolService(client as any, catalog as any);
  const result = await service.execute("invoke_command", {
    device_id: "petkit:feeder:unknown",
    action: "feed_once"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Celestia device not found in catalog: petkit:feeder:unknown");
});
