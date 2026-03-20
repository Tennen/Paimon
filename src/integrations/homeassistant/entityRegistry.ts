import WebSocket from "ws";
import { HAClient } from "./client";

export class HAEntityRegistry {
  private readonly client: HAClient;
  private readonly refreshMs: number;
  private entities = new Set<string>();
  private entityInfo: HAEntityInfo[] = [];
  private entityListRequestId: number | null = null;
  private areaListRequestId: number | null = null;
  private deviceListRequestId: number | null = null;
  private pendingEntityList: any[] | null = null;
  private pendingAreaList: any[] | null = null;
  private pendingDeviceList: any[] | null = null;
  private pendingCameraStates: Array<{ entity_id?: string; attributes?: { friendly_name?: string } }> | null = null;
  private ws: WebSocket | null = null;
  private requestId = 1;
  private authenticated = false;

  constructor(client: HAClient) {
    this.client = client;
    this.refreshMs = Number(process.env.HA_ENTITY_REFRESH_MS ?? "60000");
  }

  start(): void {
    if (!this.client.isConfigured()) {
      return;
    }

    this.connect();
    setInterval(() => this.requestList(), this.refreshMs).unref();
  }

  getEntities(): string[] {
    return Array.from(this.entities);
  }

  getEntityInfo(): HAEntityInfo[] {
    return this.entityInfo.slice();
  }

  has(entityId: string): boolean {
    return this.entities.has(entityId);
  }

  get(entityId: string): HAEntityInfo | null {
    const normalized = normalizeEntityLookupText(entityId);
    if (!normalized) {
      return null;
    }
    return this.entityInfo.find((item) => normalizeEntityLookupText(item.entity_id) === normalized) ?? null;
  }

  resolveEntityReference(
    reference: string,
    options: { preferredDomain?: string } = {}
  ): HAEntityResolveResult {
    const normalizedReference = normalizeEntityLookupText(reference);
    if (!normalizedReference) {
      return {
        ok: false,
        error: "Missing entity reference"
      };
    }

    const direct = this.get(reference);
    if (direct) {
      return this.ensureDomainMatch(direct, options.preferredDomain);
    }

    const candidates = this.entityInfo.filter((item) => {
      if (options.preferredDomain && item.domain !== options.preferredDomain) {
        return false;
      }
      return buildLookupAliases(item).some((alias) => alias === normalizedReference);
    });

    if (candidates.length === 1) {
      return {
        ok: true,
        entity: { ...candidates[0] }
      };
    }

    if (candidates.length > 1) {
      const labels = candidates
        .slice(0, 5)
        .map((item) => `${item.name} (${item.entity_id})`);
      return {
        ok: false,
        error: `Entity reference is ambiguous: ${labels.join(", ")}`
      };
    }

    const scopeHint = options.preferredDomain ? ` in domain ${options.preferredDomain}` : "";
    return {
      ok: false,
      error: `Entity not found${scopeHint}: ${reference}`
    };
  }

  private ensureDomainMatch(entity: HAEntityInfo, preferredDomain?: string): HAEntityResolveResult {
    if (!preferredDomain || entity.domain === preferredDomain) {
      return {
        ok: true,
        entity: { ...entity }
      };
    }
    return {
      ok: false,
      error: `Entity ${entity.entity_id} is not in domain ${preferredDomain}`
    };
  }

  private connect(): void {
    const ws = new WebSocket(this.client.getWebSocketUrl());
    this.ws = ws;
    this.authenticated = false;

    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("close", () => {
      this.ws = null;
      this.authenticated = false;
      setTimeout(() => this.connect(), 2000).unref();
    });
    ws.on("error", () => {
      // ignore, close handler will retry
    });
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "auth_required") {
      this.send({ type: "auth", access_token: this.client.getToken() });
      return;
    }

    if (msg.type === "auth_ok") {
      this.authenticated = true;
      this.requestList();
      return;
    }

    if (msg.type === "result") {
      if (msg.id === this.entityListRequestId && msg.success && Array.isArray(msg.result)) {
        this.pendingEntityList = msg.result;
        this.buildEntityInfo();
      } else if (msg.id === this.areaListRequestId && msg.success && Array.isArray(msg.result)) {
        this.pendingAreaList = msg.result;
        this.buildEntityInfo();
      } else if (msg.id === this.deviceListRequestId && msg.success && Array.isArray(msg.result)) {
        this.pendingDeviceList = msg.result;
        this.buildEntityInfo();
      }
    }
  }

  private requestList(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      return;
    }

    this.entityListRequestId = this.requestId++;
    this.areaListRequestId = this.requestId++;
    this.deviceListRequestId = this.requestId++;
    this.send({ id: this.entityListRequestId, type: "config/entity_registry/list" });
    this.send({ id: this.areaListRequestId, type: "config/area_registry/list" });
    this.send({ id: this.deviceListRequestId, type: "config/device_registry/list" });
    void this.refreshCameraStates();
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private buildEntityInfo(): void {
    if (!this.pendingEntityList || !this.pendingAreaList || !this.pendingDeviceList) {
      return;
    }

    const areaMap = new Map<string, string>();
    for (const area of this.pendingAreaList) {
      if (area && typeof area.area_id === "string") {
        areaMap.set(area.area_id, String(area.name ?? ""));
      }
    }

    const deviceMap = new Map<string, { name: string; area_id?: string }>();
    for (const device of this.pendingDeviceList) {
      if (device && typeof device.id === "string") {
        deviceMap.set(device.id, { name: String(device.name ?? ""), area_id: device.area_id });
      }
    }

    const nextSet = new Set<string>();
    const info: HAEntityInfo[] = [];
    for (const item of this.pendingEntityList) {
      const shouldExpose = item?.options?.conversation?.should_expose === true;
      const entityId = typeof item?.entity_id === "string" ? item.entity_id : "";
      if (!shouldExpose || !entityId) continue;
      nextSet.add(entityId);
      const domain = entityId.split(".")[0] ?? "";
      const name = String(item?.name ?? item?.original_name ?? entityId);
      const deviceId = item?.device_id;
      const device = deviceId ? deviceMap.get(deviceId)?.name : "";
      const areaId = item?.area_id ?? deviceMap.get(deviceId)?.area_id;
      const area = areaId ? areaMap.get(areaId) ?? "" : "";

      info.push({ entity_id: entityId, name, area, device, domain });
    }

    if (this.pendingCameraStates) {
      for (const state of this.pendingCameraStates) {
        const entityId = typeof state?.entity_id === "string" ? state.entity_id : "";
        if (!entityId || !entityId.startsWith("camera.")) continue;
        if (nextSet.has(entityId)) continue;

        const name = String(state?.attributes?.friendly_name ?? entityId);
        info.push({ entity_id: entityId, name, domain: "camera" });
        nextSet.add(entityId);
      }
    }

    this.entities = nextSet;
    this.entityInfo = info;
  }

  private async refreshCameraStates(): Promise<void> {
    try {
      const data = (await this.client.requestJson("GET", "/api/states")) as Array<{ entity_id?: string; attributes?: { friendly_name?: string } }>;
      this.pendingCameraStates = data.filter((item) => typeof item?.entity_id === "string" && item.entity_id.startsWith("camera."));
    } catch {
      this.pendingCameraStates = [];
    }
    this.buildEntityInfo();
  }
}

export type HAEntityInfo = {
  entity_id: string;
  name: string;
  area?: string;
  device?: string;
  domain?: string;
};

export type HAEntityResolveResult =
  | {
      ok: true;
      entity: HAEntityInfo;
    }
  | {
      ok: false;
      error: string;
    };

function buildLookupAliases(entity: HAEntityInfo): string[] {
  const aliases = new Set<string>();
  const name = normalizeEntityLookupText(entity.name);
  const area = normalizeEntityLookupText(entity.area ?? "");
  const device = normalizeEntityLookupText(entity.device ?? "");

  if (name) {
    aliases.add(name);
  }
  if (area && name) {
    aliases.add(`${area} ${name}`);
  }
  if (device && name) {
    aliases.add(`${device} ${name}`);
  }

  return Array.from(aliases);
}

function normalizeEntityLookupText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
