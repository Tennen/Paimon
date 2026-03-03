import { HomeAssistantToolService } from "../integrations/homeassistant/service";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";

export function registerTool(registry: ToolRegistry, _deps: ToolDependencies): void {
  const service = new HomeAssistantToolService();
  service.start();

  registry.register(
    {
      name: "homeassistant",
      execute: (op, args) => service.execute(op, args),
      runtimeContext: () => service.getRuntimeContext()
    },
    {
      name: "homeassistant",
      description: "Control Home Assistant devices and query their state.",
      resource: "entities",
      keywords: [
        "home assistant",
        "ha",
        "smart home",
        "home automation",
        "device",
        "devices",
        "light",
        "lights",
        "switch",
        "sensor",
        "camera",
        "thermostat",
        "设备",
        "灯",
        "开关",
        "温度",
        "摄像头"
      ],
      operations: [
        {
          op: "call_service",
          description: "Call a Home Assistant service for one or more entities.",
          params: {
            domain: "string",
            service: "string",
            entity_id: "string | string[]",
            data: "object?"
          },
          param_descriptions: {
            domain: "Service domain, such as light/switch/climate.",
            service: "Service name in the domain, such as turn_on/turn_off.",
            entity_id: "Target entity id or a list of entity ids.",
            data: "Optional extra service data."
          }
        },
        {
          op: "get_state",
          description: "Fetch current state for a single entity.",
          params: {
            entity_id: "string"
          },
          param_descriptions: {
            entity_id: "Target entity id."
          }
        },
        {
          op: "camera_snapshot",
          description: "Capture a camera snapshot and return image data.",
          params: {
            entity_id: "string"
          },
          param_descriptions: {
            entity_id: "Camera entity id."
          }
        }
      ]
    }
  );
}
