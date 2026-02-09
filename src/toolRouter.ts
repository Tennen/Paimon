import { Action, ToolResult } from "./types";
import { MockTool } from "./tools/mockTool";
import { HomeAssistantTool, HaEntityChecker } from "./tools/homeAssistantTool";
import { HAClient } from "./ha/client";

export class ToolRouter {
  private readonly mockTool = new MockTool();
  private readonly haTool: HomeAssistantTool;

  constructor(client: HAClient, isEntityAllowed: HaEntityChecker) {
    this.haTool = new HomeAssistantTool(client, isEntityAllowed);
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
