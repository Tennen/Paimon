import "dotenv/config";
import express from "express";
import { SessionManager } from "./sessionManager";
import { Orchestrator } from "./orchestrator";
import { ToolRouter } from "./toolRouter";
import { OllamaLLMEngine } from "./engines/llm/ollama";
import { buildToolSchema } from "./engines/llm/ollama/schema";
import { HttpIngressAdapter } from "./ingress/http";
import { HANotifyIngressAdapter } from "./ingress/haNotify";
import { WeComIngressAdapter } from "./ingress/wecom";
import { WeComBridgeIngressAdapter } from "./ingress/wecomBridge";
import { HAEntityRegistry } from "./ha/entityRegistry";
import { HAClient } from "./ha/client";

const app = express();
app.use(express.json({ limit: "1mb" }));

const haClient = new HAClient();
const haRegistry = new HAEntityRegistry(haClient);
haRegistry.start();

const toolRouter = new ToolRouter(haClient, (entityId) => haRegistry.has(entityId));
const llmEngine = new OllamaLLMEngine();
const toolSchema = buildToolSchema();
const orchestrator = new Orchestrator(
  toolRouter,
  llmEngine,
  toolSchema,
  () => haRegistry.getEntities(),
  () => haRegistry.getEntityInfo()
);
const sessionManager = new SessionManager(orchestrator);

new HttpIngressAdapter().register(app, sessionManager);
new HANotifyIngressAdapter().register(app, sessionManager);
new WeComIngressAdapter().register(app, sessionManager);
new WeComBridgeIngressAdapter().register(app, sessionManager);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Ingress listening on :${port}`);
});
