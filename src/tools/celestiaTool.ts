import { CelestiaToolService } from "../integrations/celestia/service";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";

export function registerTool(registry: ToolRegistry, _deps: ToolDependencies): void {
  const service = new CelestiaToolService();
  service.start();

  registry.register(
    {
      name: "celestia",
      execute: (op, args) => service.execute(op, args),
      runtimeContext: () => service.getRuntimeContext()
    },
    {
      name: "celestia",
      description: "Control Celestia smart-home devices through the AI device API.",
      resource: "devices",
      keywords: [
        "celestia",
        "smart home",
        "home automation",
        "device",
        "devices",
        "light",
        "switch",
        "sensor",
        "feeder",
        "camera",
        "petkit",
        "xiaomi",
        "haier",
        "设备",
        "智能家居",
        "喂食器",
        "灯",
        "开关",
        "传感器"
      ],
      operations: [
        {
          op: "list_devices",
          description: "List Celestia AI devices, optionally filtered by plugin/kind/query.",
          params: {
            plugin_id: "string?",
            kind: "string?",
            q: "string?"
          },
          param_descriptions: {
            plugin_id: "Optional plugin id filter, such as petkit/xiaomi/haier.",
            kind: "Optional device kind filter.",
            q: "Optional fuzzy search query."
          }
        },
        {
          op: "invoke_command",
          description: "Invoke a semantic Celestia command or a raw action on a device.",
          params: {
            target: "string?",
            device_name: "string?",
            command: "string?",
            device_id: "string?",
            action: "string?",
            params: "object?"
          },
          param_descriptions: {
            target: "Semantic target in the form device-or-room.command, or command only.",
            device_name: "Explicit device name when not using target.",
            command: "Semantic command name or alias.",
            device_id: "Explicit Celestia device id for raw action execution.",
            action: "Raw action name. Required when device_id is provided.",
            params: "Optional command/action params object."
          }
        },
        {
          op: "direct_command",
          description: "Execute direct `/celestia ...` command syntax.",
          params: {
            input: "string"
          },
          param_descriptions: {
            input: "Command body after `/celestia`, such as `call Kitchen Feeder.Feed Once | {\"portions\":2}`."
          }
        }
      ]
    }
  );

  registry.registerDirectToolCall({
    command: "/celestia",
    tool: "celestia",
    op: "direct_command",
    argName: "input",
    argMode: "rest",
    preferToolResult: true
  });
}
