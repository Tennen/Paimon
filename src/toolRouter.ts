import { Action, ToolResult } from "./types";
import { MockTool } from "./tools/mockTool";
import { HomeAssistantTool } from "./tools/homeAssistantTool";
import { Config } from "./config";

export class ToolRouter {
  private readonly mockTool = new MockTool();
  private readonly haTool: HomeAssistantTool;

  constructor(config: Config) {
    this.haTool = new HomeAssistantTool(config);
  }

  async route(action: Action): Promise<{ result: ToolResult; toolName: string }> {
    if (action.type.startsWith("ha.")) {
      const result = await this.haTool.execute(action);
      return { result, toolName: "homeassistant" };
    }

    const result = await this.mockTool.execute(action);
    return { result, toolName: "mock" };
  }
}
