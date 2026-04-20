import { useEffect } from "react";
import type { CelestiaDeviceFilters } from "@/types/admin";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useCelestiaSectionState() {
  const state = useAdminStore(useShallow((store) => ({
    devices: store.celestiaDevices,
    configured: store.celestiaConfigured,
    baseUrl: store.celestiaBaseUrl,
    filters: store.celestiaFilters,
    selectedDeviceId: store.selectedCelestiaDeviceId,
    loading: store.loadingCelestiaDevices,
    error: store.celestiaDeviceError,
    setFilters: store.setCelestiaFilters,
    setSelectedDeviceId: store.setSelectedCelestiaDeviceId,
    loadDevices: store.loadCelestiaDevices
  })));

  useEffect(() => {
    void state.loadDevices();
  }, []);

  return {
    devices: state.devices,
    configured: state.configured,
    baseUrl: state.baseUrl,
    filters: state.filters,
    selectedDeviceId: state.selectedDeviceId,
    selectedDevice: state.devices.find((device) => device.id === state.selectedDeviceId) ?? null,
    loading: state.loading,
    error: state.error,
    onFilterChange: <K extends keyof CelestiaDeviceFilters>(key: K, value: CelestiaDeviceFilters[K]) => {
      state.setFilters((prev) => ({ ...prev, [key]: value }));
    },
    onSelectDevice: state.setSelectedDeviceId,
    onRefresh: () => {
      void state.loadDevices();
    }
  };
}
