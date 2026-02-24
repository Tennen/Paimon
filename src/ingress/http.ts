import { Express, Request, Response as ExResponse } from "express";
import { IngressAdapter } from "./types";
import { SessionManager } from "../core/sessionManager";
import { Envelope } from "../types";

export class HttpIngressAdapter implements IngressAdapter {
  register(app: Express, sessionManager: SessionManager): void {
    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });

    app.get("/sessions", (_req, res) => {
      res.json({ sessions: sessionManager.getSessions() });
    });

    app.post("/ingress", async (req: Request, res: ExResponse) => {
      const body = req.body as Partial<Envelope>;
      if (!body || !body.requestId || !body.sessionId || !body.source || !body.kind) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const envelope: Envelope = {
        requestId: body.requestId,
        source: body.source,
        sessionId: body.sessionId,
        kind: body.kind,
        text: body.text,
        audioPath: body.audioPath,
        meta: body.meta,
        receivedAt: body.receivedAt ?? new Date().toISOString()
      };

      try {
        const response = await sessionManager.enqueue(envelope);
        res.json(response);
      } catch {
        res.status(500).json({ error: "Internal error" });
      }
    });
  }
}
