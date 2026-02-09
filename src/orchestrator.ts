import { Envelope, Response } from "./types";
import { mockSTT } from "./mockSTT";
import { policyCheck } from "./policy";
import { ToolRouter } from "./toolRouter";
import { writeAudit } from "./auditLogger";
import { LLMEngine, LLMPlanResult, LLMRuntimeContext } from "./engines/llm/llm";

export class Orchestrator {
  private readonly processed = new Map<string, Response>();
  private readonly toolRouter: ToolRouter;
  private readonly llmEngine: LLMEngine;
  private readonly toolSchema: string;
  private readonly allowedHaEntities: () => string[];
  private readonly haEntityInfo: () => Array<{ entity_id: string; name: string; area?: string; device?: string; domain?: string }>;

  constructor(
    toolRouter: ToolRouter,
    llmEngine: LLMEngine,
    toolSchema: string,
    allowedHaEntities: () => string[],
    haEntityInfo: () => Array<{ entity_id: string; name: string; area?: string; device?: string; domain?: string }>
  ) {
    this.toolRouter = toolRouter;
    this.llmEngine = llmEngine;
    this.toolSchema = toolSchema;
    this.allowedHaEntities = allowedHaEntities;
    this.haEntityInfo = haEntityInfo;
  }

  async handle(envelope: Envelope): Promise<Response> {
    const start = Date.now();

    const cached = this.processed.get(envelope.requestId);
    if (cached) {
      return cached;
    }

    const text = await mockSTT(envelope.text, envelope.audioPath);
    const entities = this.allowedHaEntities();
    const entityInfo = this.haEntityInfo();

    const runtimeContext: LLMRuntimeContext = {
      now: new Date().toISOString(),
      timezone: "Europe/Amsterdam",
      defaults: {},
      allowed_ha_entities: entities.length > 0 ? entities : undefined,
      ha_entities: entityInfo.length > 0 ? entityInfo : undefined
    };
    console.log("text", text);

    const llmResult = await this.planWithMeta(text, runtimeContext, this.toolSchema);
    console.log("llmResult", llmResult);
    const action = llmResult.action;

    const policy = await policyCheck(action);
    if (!policy.allowed) {
      const response = { text: "Policy rejected" };
      this.processed.set(envelope.requestId, response);
      return response;
    }

    if (action.type === "respond") {
      const text = String((action.params as Record<string, unknown>).text ?? "");
      const response: Response = { text: text || "OK" };
      this.processed.set(envelope.requestId, response);

      const latencyMs = Date.now() - start;

      const ingressMessageId = (envelope.meta as Record<string, unknown> | undefined)?.ingress_message_id;

      writeAudit({
        requestId: envelope.requestId,
        sessionId: envelope.sessionId,
        source: envelope.source,
        ingress_message_id: typeof ingressMessageId === "string" ? ingressMessageId : undefined,
        actionType: action.type,
        latencyMs,
        tool: "llm",
        llm_provider: llmResult.meta.llm_provider,
        model: llmResult.meta.model,
        retries: llmResult.meta.retries,
        parse_ok: llmResult.meta.parse_ok,
        raw_output_length: llmResult.meta.raw_output_length,
        fallback: llmResult.meta.fallback
      });
      console.log("response", response);
      return response;
    }

    const { result, toolName } = await this.toolRouter.route(action);
    console.log("toolResult", result, toolName);
    const caption = extractCaption(result.output);
    const response: Response = {
      text: result.ok ? (caption || "OK") : `Failed: ${result.error ?? "unknown"}`,
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

    const ingressMessageId = (envelope.meta as Record<string, unknown> | undefined)?.ingress_message_id;

    writeAudit({
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      source: envelope.source,
      ingress_message_id: typeof ingressMessageId === "string" ? ingressMessageId : undefined,
      actionType: action.type,
      latencyMs,
      tool: toolName,
      ha_action: haAction,
      entity_id: entityId,
      llm_provider: llmResult.meta.llm_provider,
      model: llmResult.meta.model,
      retries: llmResult.meta.retries,
      parse_ok: llmResult.meta.parse_ok,
      raw_output_length: llmResult.meta.raw_output_length,
      fallback: llmResult.meta.fallback
    });
    console.log("response", response);
    return response;
  }

  private async planWithMeta(text: string, runtimeContext: LLMRuntimeContext, toolSchema: string): Promise<LLMPlanResult> {
    const engine = this.llmEngine as LLMEngine & {
      planWithMeta?: (t: string, rc: LLMRuntimeContext, ts: string) => Promise<LLMPlanResult>;
    };

    if (engine.planWithMeta) {
      return engine.planWithMeta(text, runtimeContext, toolSchema);
    }

    const action = await engine.plan(text, runtimeContext, toolSchema);
    return {
      action,
      meta: {
        llm_provider: "ollama",
        model: process.env.OLLAMA_MODEL ?? "unknown",
        retries: 0,
        parse_ok: true,
        raw_output_length: 0,
        fallback: false
      }
    };
  }
}

function extractCaption(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const maybe = (output as { caption?: unknown }).caption;
  return typeof maybe === "string" ? maybe.trim() : undefined;
}
