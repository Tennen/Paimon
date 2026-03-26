import { Envelope, Response } from "../types";
import { Orchestrator } from "./orchestrator";

export class SessionManager {
  private readonly orchestrator: Orchestrator;
  private readonly queues = new Map<string, Promise<Response>>();

  constructor(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator;
  }

  enqueue(envelope: Envelope): Promise<Response> {
    const sessionId = envelope.sessionId;
    const prior = this.queues.get(sessionId) ?? Promise.resolve({ text: "" });

    const next = prior
      .catch(() => ({ text: "" }))
      .then(() => this.orchestrator.handle(envelope));

    this.queues.set(sessionId, next);
    void next.finally(() => {
      if (this.queues.get(sessionId) === next) {
        this.queues.delete(sessionId);
      }
    });
    return next;
  }

  getSessions(): string[] {
    return Array.from(this.queues.keys());
  }
}
