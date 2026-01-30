import { Envelope, Response } from "./types";
import { mockSTT } from "./mockSTT";
import { mockLLM } from "./mockLLM";
import { policyCheck } from "./policy";
import { ToolRouter } from "./toolRouter";
import { writeAudit } from "./auditLogger";

export class Orchestrator {
  private readonly processed = new Map<string, Response>();
  private readonly toolRouter: ToolRouter;

  constructor(toolRouter: ToolRouter) {
    this.toolRouter = toolRouter;
  }

  async handle(envelope: Envelope): Promise<Response> {
    const start = Date.now();

    const cached = this.processed.get(envelope.requestId);
    if (cached) {
      return cached;
    }

    const text = await mockSTT(envelope.text, envelope.audioPath);
    const action = await mockLLM(text);

    const policy = await policyCheck(action);
    if (!policy.allowed) {
      const response = { text: "Policy rejected" };
      this.processed.set(envelope.requestId, response);
      return response;
    }

    const { result, toolName } = await this.toolRouter.route(action);

    const response: Response = {
      text: result.ok ? "OK" : `Failed: ${result.error ?? "unknown"}`,
      data: result.output
    };

    this.processed.set(envelope.requestId, response);

    const latencyMs = Date.now() - start;
    const entityId = action.params.entity_id as string | string[] | undefined;
    const haAction = action.type === "ha.call_service"
      ? "call_service"
      : action.type === "ha.get_state"
        ? "get_state"
        : undefined;

    writeAudit({
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      actionType: action.type,
      latencyMs,
      tool: toolName,
      ha_action: haAction,
      entity_id: entityId
    });

    return response;
  }
}
