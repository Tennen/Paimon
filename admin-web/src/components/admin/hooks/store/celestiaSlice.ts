import type { CelestiaDeviceFilters, CelestiaDevicesResponse } from "@/types/admin";
import { request } from "../adminApi";
import type { AdminCelestiaSlice, StateUpdater } from "./slices";
import type { AdminSliceCreator } from "./types";

const DEFAULT_CELESTIA_FILTERS: CelestiaDeviceFilters = {
  pluginId: "",
  kind: "",
  query: ""
};

function resolveUpdater<T>(updater: StateUpdater<T>, prev: T): T {
  if (typeof updater === "function") {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function buildCelestiaDevicesUrl(filters: CelestiaDeviceFilters): string {
  const params = new URLSearchParams();
  if (filters.pluginId.trim()) {
    params.set("plugin_id", filters.pluginId.trim());
  }
  if (filters.kind.trim()) {
    params.set("kind", filters.kind.trim());
  }
  if (filters.query.trim()) {
    params.set("q", filters.query.trim());
  }
  const query = params.toString();
  return query ? `/admin/api/celestia/devices?${query}` : "/admin/api/celestia/devices";
}

export const createCelestiaSlice: AdminSliceCreator<AdminCelestiaSlice> = (set, get) => ({
  celestiaDevices: [],
  celestiaConfigured: false,
  celestiaBaseUrl: "",
  celestiaFilters: DEFAULT_CELESTIA_FILTERS,
  selectedCelestiaDeviceId: "",
  loadingCelestiaDevices: false,
  celestiaDeviceError: "",
  setCelestiaFilters: (value) => {
    set((state) => ({
      celestiaFilters: resolveUpdater(value, state.celestiaFilters)
    }));
  },
  setSelectedCelestiaDeviceId: (deviceId) => {
    set({ selectedCelestiaDeviceId: deviceId });
  },
  loadCelestiaDevices: async () => {
    set({ loadingCelestiaDevices: true, celestiaDeviceError: "" });
    try {
      const payload = await request<CelestiaDevicesResponse>(buildCelestiaDevicesUrl(get().celestiaFilters));
      const devices = Array.isArray(payload.devices) ? payload.devices : [];
      const currentSelected = get().selectedCelestiaDeviceId;
      set({
        celestiaDevices: devices,
        celestiaConfigured: Boolean(payload.configured),
        celestiaBaseUrl: payload.baseUrl ?? "",
        selectedCelestiaDeviceId: devices.some((item) => item.id === currentSelected)
          ? currentSelected
          : devices[0]?.id ?? ""
      });
    } catch (error) {
      set({
        celestiaDeviceError: toErrorText(error),
        celestiaDevices: [],
        selectedCelestiaDeviceId: ""
      });
    } finally {
      set({ loadingCelestiaDevices: false });
    }
  }
});
