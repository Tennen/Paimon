export type CelestiaCommandParam = {
  name: string;
  type?: string;
  default?: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
};

export type CelestiaDeviceCommand = {
  name: string;
  aliases: string[];
  action: string;
  params: CelestiaCommandParam[];
};

export type CelestiaDevice = {
  id: string;
  name: string;
  aliases: string[];
  kind?: string;
  plugin_id?: string;
  commands: CelestiaDeviceCommand[];
};

export type CelestiaDeviceFilters = {
  pluginId: string;
  kind: string;
  query: string;
};

export type CelestiaDevicesResponse = {
  ok: boolean;
  configured: boolean;
  baseUrl: string;
  devices: CelestiaDevice[];
  filters?: {
    plugin_id?: string;
    kind?: string;
    q?: string;
  };
};
