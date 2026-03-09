import assert from "node:assert/strict";
import test from "node:test";
import { McpService } from "../../../integrations/mcp/service";
import { ReAgentModuleContext } from "../types";
import { MCP_MODULE_CALL_ACTION, createMcpModule } from "./mcpModule";

function createContext(overrides: Partial<ReAgentModuleContext> = {}): ReAgentModuleContext {
  return { sessionId: "s-1", input: "", step: 1, maxSteps: 6, history: [], ...overrides };
}

test("mcpModule returns fallback error when endpoint is not configured", async () => {
  let called = false;
  const module = createMcpModule(
    new McpService({
      endpoint: " ",
      fetchImpl: async () => {
        called = true;
        throw new Error("should not call");
      }
    })
  );

  const result = await module.execute(MCP_MODULE_CALL_ACTION, { method: "tools/list" }, createContext());
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /endpoint is not configured/i);
});

test("mcpModule sends JSON-RPC payload and returns result", async () => {
  let url = "";
  let body: Record<string, unknown> = {};
  const module = createMcpModule(
    new McpService({
      endpoint: "http://127.0.0.1:8123/mcp",
      fetchImpl: async (input, init) => {
        url = input;
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id ?? 1,
              result: { accepted: true, params: body.params ?? null }
            })
        } as Response;
      }
    })
  );

  const result = await module.execute(
    MCP_MODULE_CALL_ACTION,
    { method: "tools/call", params: { tool: "planner", goal: "ship" } },
    createContext({ sessionId: "s-2" })
  );

  assert.equal(url, "http://127.0.0.1:8123/mcp");
  assert.equal(body.method, "tools/call");
  assert.deepEqual(body.params, { tool: "planner", goal: "ship" });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("expected success");
  const output = result.output as { method: string; result?: { accepted: boolean } };
  assert.equal(output.method, "tools/call");
  assert.equal(output.result?.accepted, true);
});

test("mcpModule validates action/method and maps rpc error", async () => {
  const module = createMcpModule(
    new McpService({
      endpoint: "http://127.0.0.1:8123/mcp",
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { code: -32601, message: "Method not found" }
            })
        }) as Response
    })
  );

  const unsupported = await module.execute("query", { method: "tools/list" }, createContext());
  assert.match(unsupported.error ?? "", /Unsupported mcp action/);

  const missingMethod = await module.execute(MCP_MODULE_CALL_ACTION, { params: {} }, createContext());
  assert.equal(missingMethod.error, "Missing method");

  const rpcError = await module.execute(MCP_MODULE_CALL_ACTION, { method: "tools/missing" }, createContext());
  assert.match(rpcError.error ?? "", /Method not found/);
});
