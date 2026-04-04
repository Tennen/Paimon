import { CelestiaClient } from "./client";

export type CelestiaAICommandParam = {
  name: string;
  type?: string;
  default?: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
};

export type CelestiaAICommand = {
  name: string;
  aliases: string[];
  action: string;
  params: CelestiaAICommandParam[];
};

export type CelestiaAIDevice = {
  id: string;
  name: string;
  aliases: string[];
  kind?: string;
  plugin_id?: string;
  commands: CelestiaAICommand[];
};

export class CelestiaDeviceCatalog {
  private readonly client: CelestiaClient;
  private readonly refreshMs: number;
  private devices: CelestiaAIDevice[] = [];
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(client: CelestiaClient) {
    this.client = client;
    this.refreshMs = Number(process.env.CELESTIA_DEVICE_REFRESH_MS ?? "60000");
  }

  start(): void {
    if (!this.client.isConfigured()) {
      return;
    }

    this.refreshInBackground();
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setInterval(() => this.refreshInBackground(), this.refreshMs);
    this.refreshTimer.unref();
  }

  getDevices(): CelestiaAIDevice[] {
    return this.devices.map((device) => ({
      ...device,
      aliases: device.aliases.slice(),
      commands: device.commands.map((command) => ({
        ...command,
        aliases: command.aliases.slice(),
        params: command.params.map((param) => ({ ...param }))
      }))
    }));
  }

  hasDevice(deviceId: string): boolean {
    const normalized = String(deviceId ?? "").trim();
    if (!normalized) {
      return false;
    }
    return this.devices.some((device) => device.id === normalized);
  }

  async refreshNow(): Promise<CelestiaAIDevice[]> {
    const raw = await this.client.requestJson<unknown[]>("GET", "/api/ai/v1/devices");
    const normalized = normalizeDeviceList(raw);
    this.devices = normalized;
    return this.getDevices();
  }

  private refreshInBackground(): void {
    void this.refreshNow().catch((error) => {
      console.error(
        `[CelestiaCatalog] refresh devices failed, keeping cached catalog size=${this.devices.length}`,
        error
      );
    });
  }
}

function normalizeDeviceList(input: unknown): CelestiaAIDevice[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const devices: CelestiaAIDevice[] = [];
  for (const item of input) {
    const normalized = normalizeDevice(item);
    if (normalized) {
      devices.push(normalized);
    }
  }
  return devices;
}

function normalizeDevice(input: unknown): CelestiaAIDevice | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const id = readString(raw.id);
  const name = readString(raw.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    aliases: normalizeStringList(raw.aliases),
    ...(readString(raw.kind) ? { kind: readString(raw.kind) } : {}),
    ...(readString(raw.plugin_id) ? { plugin_id: readString(raw.plugin_id) } : {}),
    commands: normalizeCommands(raw.commands)
  };
}

function normalizeCommands(input: unknown): CelestiaAICommand[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const commands: CelestiaAICommand[] = [];
  for (const item of input) {
    const normalized = normalizeCommand(item);
    if (normalized) {
      commands.push(normalized);
    }
  }
  return commands;
}

function normalizeCommand(input: unknown): CelestiaAICommand | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const name = readString(raw.name);
  const action = readString(raw.action);
  if (!name || !action) {
    return null;
  }

  return {
    name,
    action,
    aliases: normalizeStringList(raw.aliases),
    params: normalizeParams(raw.params)
  };
}

function normalizeParams(input: unknown): CelestiaAICommandParam[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const params: CelestiaAICommandParam[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const name = readString(raw.name);
    if (!name) {
      continue;
    }

    const normalized: CelestiaAICommandParam = {
      name,
      ...(readString(raw.type) ? { type: readString(raw.type) } : {}),
      ...(Object.prototype.hasOwnProperty.call(raw, "default") ? { default: raw.default } : {}),
      ...(typeof raw.required === "boolean" ? { required: raw.required } : {}),
      ...(typeof raw.min === "number" ? { min: raw.min } : {}),
      ...(typeof raw.max === "number" ? { max: raw.max } : {}),
      ...(typeof raw.step === "number" ? { step: raw.step } : {})
    };
    params.push(normalized);
  }
  return params;
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
