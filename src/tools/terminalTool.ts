import { TerminalToolService } from "../integrations/terminal/service";
import { ToolDependencies, ToolRegistry } from "./toolRegistry";

export function registerTool(registry: ToolRegistry, _deps: ToolDependencies): void {
  const service = new TerminalToolService();

  registry.register(
    {
      name: "terminal",
      execute: (op, args) => service.execute(op, args)
    },
    {
      name: "terminal",
      description: "Run local terminal commands on this machine.",
      resource: "system",
      operations: [
        {
          op: "exec",
          description: "Execute a command with structured argv. Prefer args array to preserve spaces in values.",
          params: {
            command: "string",
            args: "string[]?"
          },
          param_descriptions: {
            command: "Executable only, for example: remindctl. Legacy full command line is still accepted for compatibility.",
            args: "Optional argument array. Each element is one argument value; keep values with spaces as one element, e.g. \"2026-01-04 12:34\"."
          }
        }
      ]
    }
  );
}
