import "dotenv/config";
import express from "express";
import { SessionManager } from "./sessionManager";
import { Orchestrator } from "./orchestrator";
import { ToolRouter } from "./toolRouter";
import { OllamaLLMEngine } from "./engines/llm/ollama";
import { buildActionSchema } from "./engines/llm/ollama/schema";
import { HttpIngressAdapter } from "./ingress/http";
import { HANotifyIngressAdapter } from "./ingress/haNotify";
import { WeComIngressAdapter } from "./ingress/wecom";
import { WeComBridgeIngressAdapter } from "./ingress/wecomBridge";
import { MemoryStore } from "./memory/memoryStore";
import { SkillManager } from "./skills/skillManager";
import { ToolRegistry, loadTools } from "./tools/toolRegistry";

const app = express();
app.use(express.json({ limit: "1mb" }));


const skillManager = new SkillManager();
const memoryStore = new MemoryStore();

const registry = new ToolRegistry();
loadTools(registry, { skillManager });
const toolRouter = new ToolRouter(registry);
const llmEngine = new OllamaLLMEngine();
const actionSchema = buildActionSchema();
const orchestrator = new Orchestrator(
  toolRouter,
  llmEngine,
  actionSchema,
  memoryStore,
  skillManager,
  registry
);
const sessionManager = new SessionManager(orchestrator);

new HttpIngressAdapter().register(app, sessionManager);
new HANotifyIngressAdapter().register(app, sessionManager);
new WeComIngressAdapter().register(app, sessionManager);
new WeComBridgeIngressAdapter().register(app, sessionManager);

const port = Number(process.env.PORT ?? 3000);

async function startServer() {
  try {
    console.log("Checking and installing skill dependencies...");
    await skillManager.ensureSkillsInstalled();
    console.log("Skill dependencies check completed");

    app.listen(port, () => {
      console.log(`Ingress listening on :${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
