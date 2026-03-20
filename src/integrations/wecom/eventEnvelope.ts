import { Envelope } from "../../types";

const WECOM_MSG_TYPE_EVENT = "event";
const WECOM_EVENT_TYPE_CLICK = "click";

export type WeComClickEventEnvelopeInput = {
  requestId: string;
  sessionId?: string;
  fromUser: string;
  toUser: string;
  agentId?: string;
  eventKey: string;
  receivedAt: string;
};

export type WeComClickEventContext = {
  eventKey: string;
  fromUser: string;
  toUser: string;
  agentId?: string;
  receivedAt: string;
};

export function buildWeComClickEventEnvelope(input: WeComClickEventEnvelopeInput): Envelope {
  const eventKey = normalizeText(input.eventKey);
  const fromUser = normalizeText(input.fromUser);
  const toUser = normalizeText(input.toUser);
  const agentId = normalizeText(input.agentId);
  const sessionId = normalizeText(input.sessionId) || fromUser;

  return {
    requestId: normalizeText(input.requestId) || `${sessionId}-${Date.now()}`,
    source: "wecom",
    sessionId,
    kind: "event",
    meta: {
      callback_to_user: fromUser || undefined,
      wecom_msg_type: WECOM_MSG_TYPE_EVENT,
      wecom_event_type: WECOM_EVENT_TYPE_CLICK,
      wecom_event_key: eventKey || undefined,
      wecom_agent_id: agentId || undefined,
      wecom_to_user: toUser || undefined
    },
    receivedAt: normalizeText(input.receivedAt) || new Date().toISOString()
  };
}

export function readWeComClickEventContext(envelope: Envelope): WeComClickEventContext | null {
  if (normalizeText(envelope.source) !== "wecom") {
    return null;
  }

  const meta = (envelope.meta ?? {}) as Record<string, unknown>;
  const msgType = normalizeText(meta.wecom_msg_type);
  const eventType = normalizeText(meta.wecom_event_type);
  if (msgType !== WECOM_MSG_TYPE_EVENT || eventType !== WECOM_EVENT_TYPE_CLICK) {
    return null;
  }

  const eventKey = normalizeText(meta.wecom_event_key);
  const fromUser = normalizeText(meta.callback_to_user) || normalizeText(envelope.sessionId);
  if (!eventKey || !fromUser) {
    return null;
  }

  return {
    eventKey,
    fromUser,
    toUser: normalizeText(meta.wecom_to_user),
    agentId: normalizeText(meta.wecom_agent_id) || undefined,
    receivedAt: normalizeText(envelope.receivedAt) || new Date().toISOString()
  };
}

function normalizeText(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}
