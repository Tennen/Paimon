import express from "express";
import { SessionManager } from "./sessionManager";
import { Orchestrator } from "./orchestrator";
import { ToolRouter } from "./toolRouter";
import { loadConfig } from "./config";
import { Envelope } from "./types";

const app = express();
app.use(express.json({ limit: "1mb" }));

const config = loadConfig();
const toolRouter = new ToolRouter(config);
const orchestrator = new Orchestrator(toolRouter);
const sessionManager = new SessionManager(orchestrator);

app.post("/ingress", async (req, res) => {
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
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Ingress listening on :${port}`);
});
