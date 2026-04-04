import { ToolResult } from "../../types";
import { CelestiaClient } from "./client";
import { CelestiaDeviceCatalog, CelestiaAIDevice } from "./catalog";

export class CelestiaToolService {
  private readonly client: CelestiaClient;
  private readonly catalog: CelestiaDeviceCatalog;

  constructor(client?: CelestiaClient, catalog?: CelestiaDeviceCatalog) {
    this.client = client ?? new CelestiaClient();
    this.catalog = catalog ?? new CelestiaDeviceCatalog(this.client);
  }

  start(): void {
    this.catalog.start();
  }

  getRuntimeContext(): { devices: CelestiaAIDevice[] } {
    return {
      devices: this.catalog.getDevices()
    };
  }

  async execute(op: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (op === "list_devices") {
      return this.listDevices(args);
    }

    if (op === "invoke_command") {
      return this.invokeCommand(args);
    }

    if (op === "direct_command") {
      return this.executeDirectCommand(args);
    }

    return { ok: false, error: `Unsupported op: ${op ?? "unknown"}` };
  }

  private async listDevices(args: Record<string, unknown>): Promise<ToolResult> {
    const pluginId = readString(args.plugin_id);
    const kind = readString(args.kind);
    const query = readString(args.q);

    try {
      const devices = pluginId || kind || query
        ? await this.client.requestJson<CelestiaAIDevice[]>("GET", "/api/ai/v1/devices", {
            query: {
              ...(pluginId ? { plugin_id: pluginId } : {}),
              ...(kind ? { kind } : {}),
              ...(query ? { q: query } : {})
            }
          })
        : await this.catalog.refreshNow();

      return {
        ok: true,
        output: {
          data: devices,
          meta: {
            celestia_action: "list_devices",
            count: Array.isArray(devices) ? devices.length : 0,
            ...(pluginId ? { plugin_id: pluginId } : {}),
            ...(kind ? { kind } : {}),
            ...(query ? { q: query } : {})
          }
        }
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async invokeCommand(args: Record<string, unknown>): Promise<ToolResult> {
    const target = readString(args.target);
    const deviceName = readString(args.device_name);
    const command = readString(args.command);
    const deviceId = readString(args.device_id);
    const action = readString(args.action);
    const params = normalizeParams(args.params);

    const body = buildInvokeCommandBody({
      target,
      deviceName,
      command,
      deviceId,
      action,
      params,
      catalog: this.catalog
    });

    if (!body.ok) {
      return { ok: false, error: body.error };
    }

    try {
      const output = await this.client.requestJson<unknown>("POST", "/api/ai/v1/commands", {
        body: body.request
      });
      return {
        ok: true,
        output: {
          data: output,
          meta: {
            celestia_action: "invoke_command",
            mode: deviceId ? "raw" : "semantic",
            ...(target ? { target } : {}),
            ...(deviceName ? { device_name: deviceName } : {}),
            ...(command ? { command } : {}),
            ...(deviceId ? { device_id: deviceId } : {}),
            ...(action ? { action } : {})
          }
        }
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async executeDirectCommand(args: Record<string, unknown>): Promise<ToolResult> {
    const input = readString(args.input);
    if (!input) {
      return {
        ok: false,
        error: "Missing direct command input. Usage: /celestia list [query] | /celestia call <target> | {json params} | /celestia raw <device_id> <action> | {json params}"
      };
    }

    const parsed = parseDirectCelestiaCommand(input);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    if (parsed.command === "list") {
      const result = await this.listDevices(parsed.query ? { q: parsed.query } : {});
      if (!result.ok) {
        return result;
      }
      return {
        ok: true,
        output: {
          text: parsed.query ? `已查询 Celestia 设备：${parsed.query}` : "已获取 Celestia 设备列表",
          ...(result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {})
        }
      };
    }

    if (parsed.command === "call") {
      const result = await this.invokeCommand({
        target: parsed.target,
        ...(parsed.params ? { params: parsed.params } : {})
      });
      if (!result.ok) {
        return result;
      }
      return {
        ok: true,
        output: {
          text: `已执行 Celestia 指令：${parsed.target}`,
          ...(result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {})
        }
      };
    }

    const result = await this.invokeCommand({
      device_id: parsed.deviceId,
      action: parsed.action,
      ...(parsed.params ? { params: parsed.params } : {})
    });
    if (!result.ok) {
      return result;
    }
    return {
      ok: true,
      output: {
        text: `已执行 Celestia 原始动作：${parsed.deviceId}.${parsed.action}`,
        ...(result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {})
      }
    };
  }
}

type ParsedDirectCelestiaCommand =
  | {
      ok: true;
      command: "list";
      query?: string;
    }
  | {
      ok: true;
      command: "call";
      target: string;
      params?: Record<string, unknown>;
    }
  | {
      ok: true;
      command: "raw";
      deviceId: string;
      action: string;
      params?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

type InvokeCommandBodyResult =
  | {
      ok: true;
      request: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

function buildInvokeCommandBody(input: {
  target: string;
  deviceName: string;
  command: string;
  deviceId: string;
  action: string;
  params?: Record<string, unknown>;
  catalog: CelestiaDeviceCatalog;
}): InvokeCommandBodyResult {
  if (input.deviceId) {
    if (!input.action) {
      return { ok: false, error: "Missing action for raw Celestia command" };
    }

    const catalogDevices = input.catalog.getDevices();
    if (catalogDevices.length > 0 && !input.catalog.hasDevice(input.deviceId)) {
      return { ok: false, error: `Celestia device not found in catalog: ${input.deviceId}` };
    }

    return {
      ok: true,
      request: {
        device_id: input.deviceId,
        action: input.action,
        ...(input.params ? { params: input.params } : {})
      }
    };
  }

  if (!input.target && !input.command) {
    return {
      ok: false,
      error: "Missing Celestia target or command"
    };
  }

  if (input.deviceName && !input.command) {
    return {
      ok: false,
      error: "Missing command when device_name is provided"
    };
  }

  return {
    ok: true,
    request: {
      ...(input.target ? { target: input.target } : {}),
      ...(input.deviceName ? { device_name: input.deviceName } : {}),
      ...(input.command ? { command: input.command } : {}),
      ...(input.params ? { params: input.params } : {})
    }
  };
}

function parseDirectCelestiaCommand(input: string): ParsedDirectCelestiaCommand {
  const trimmed = readString(input);
  const firstSpace = trimmed.indexOf(" ");
  const command = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).trim().toLowerCase();
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  if (command === "list") {
    return {
      ok: true,
      command: "list",
      ...(rest ? { query: rest } : {})
    };
  }

  if (command === "call" || command === "invoke") {
    const parsedPayload = parsePipeJsonPayload(rest);
    if (!parsedPayload.ok) {
      return parsedPayload;
    }
    if (!parsedPayload.head) {
      return {
        ok: false,
        error: "Usage: /celestia call <target> | {json params}"
      };
    }
    return {
      ok: true,
      command: "call",
      target: parsedPayload.head,
      ...(parsedPayload.params ? { params: parsedPayload.params } : {})
    };
  }

  if (command === "raw") {
    const parsedPayload = parsePipeJsonPayload(rest);
    if (!parsedPayload.ok) {
      return parsedPayload;
    }
    const tokens = parsedPayload.head.split(/\s+/).filter(Boolean);
    if (tokens.length !== 2) {
      return {
        ok: false,
        error: "Usage: /celestia raw <device_id> <action> | {json params}"
      };
    }
    return {
      ok: true,
      command: "raw",
      deviceId: tokens[0],
      action: tokens[1],
      ...(parsedPayload.params ? { params: parsedPayload.params } : {})
    };
  }

  return {
    ok: false,
    error: "Unsupported /celestia command. Supported: list, call, raw"
  };
}

function parsePipeJsonPayload(
  input: string
):
  | {
      ok: true;
      head: string;
      params?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    } {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: true, head: "" };
  }

  const pipeIndex = raw.indexOf("|");
  if (pipeIndex === -1) {
    return { ok: true, head: raw };
  }

  const head = raw.slice(0, pipeIndex).trim();
  const jsonText = raw.slice(pipeIndex + 1).trim();
  if (!jsonText) {
    return {
      ok: false,
      error: "Expected JSON params after `|`"
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: "Celestia params must be a JSON object"
      };
    }
    return {
      ok: true,
      head,
      params: parsed as Record<string, unknown>
    };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid Celestia params JSON: ${(error as Error).message}`
    };
  }
}

function normalizeParams(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  return input as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
