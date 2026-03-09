import { McpJsonRpcParams, McpService } from "../../../integrations/mcp/service";
import { ReAgentModule } from "../types";

export const MCP_MODULE_NAME = "mcp";
export const MCP_MODULE_CALL_ACTION = "call";

export function createMcpModule(service: McpService = new McpService()): ReAgentModule {
  return {
    name: MCP_MODULE_NAME,
    description: "Call MCP endpoint with JSON-RPC.",
    execute: async (action, params) => {
      if (action !== MCP_MODULE_CALL_ACTION) {
        return { ok: false, error: `Unsupported mcp action: ${action || "unknown"}` };
      }

      const method = resolveMethod(params);
      if (!method) {
        return { ok: false, error: "Missing method" };
      }

      const mcpParams = resolveParams(params);
      const output = await service.call(method, mcpParams);
      if (!output.ok) {
        return { ok: false, error: output.error?.message ?? "MCP call failed" };
      }

      return { ok: true, output };
    }
  };
}

function resolveMethod(params: Record<string, unknown>): string {
  const methodFromMethod = typeof params.method === "string" ? params.method : "";
  const methodFromName = typeof params.name === "string" ? params.name : "";
  return (methodFromMethod || methodFromName).trim();
}

function resolveParams(params: Record<string, unknown>): McpJsonRpcParams {
  const explicitParams = params.params;
  if (Array.isArray(explicitParams) || isRecord(explicitParams)) {
    return explicitParams;
  }

  const payload: Record<string, unknown> = { ...params };
  delete payload.method;
  delete payload.name;
  delete payload.params;
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
