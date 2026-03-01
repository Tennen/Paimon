import "dotenv/config";
import express from "express";
import { SessionManager } from "./core/sessionManager";
import { Orchestrator } from "./core/orchestrator";
import { ToolRouter } from "./core/toolRouter";
import { OllamaLLMEngine } from "./engines/llm/ollama";
import { HttpIngressAdapter } from "./ingress/http";
import { HANotifyIngressAdapter } from "./ingress/haNotify";
import { WeComIngressAdapter } from "./ingress/wecom";
import { WeComBridgeIngressAdapter } from "./ingress/wecomBridge";
import { MemoryStore } from "./memory/memoryStore";
import { SkillManager } from "./skills/skillManager";
import { ToolRegistry, loadTools } from "./runtime-tools/toolRegistry";
import { CallbackDispatcher } from "./integrations/wecom/callbackDispatcher";
import { EnvConfigStore } from "./config/envConfigStore";
import { SchedulerService } from "./scheduler/schedulerService";
import { AdminIngressAdapter } from "./ingress/admin";
import { EvolutionEngine } from "./evolution/evolutionEngine";
import { EvolutionCodexConfigService } from "./evolution/codexConfigService";
import { EvolutionOperatorService } from "./evolution/operatorService";
import { sttRuntime } from "./engines/stt";

const app = express();
app.use(express.json({ limit: "1mb" }));


const skillManager = new SkillManager();
const memoryStore = new MemoryStore();
const envStore = new EnvConfigStore();
const evolutionEngine = new EvolutionEngine();
const codexConfigService = new EvolutionCodexConfigService(envStore);
const evolutionService = new EvolutionOperatorService(evolutionEngine, codexConfigService);

const registry = new ToolRegistry();
loadTools(registry, { skillManager, evolutionService });
const toolRouter = new ToolRouter(registry);
const llmEngine = new OllamaLLMEngine();
const callbackDispatcher = new CallbackDispatcher();
const orchestrator = new Orchestrator(
  toolRouter,
  llmEngine,
  memoryStore,
  skillManager,
  registry,
  callbackDispatcher
);
const sessionManager = new SessionManager(orchestrator);
const scheduler = new SchedulerService(sessionManager);

new HttpIngressAdapter().register(app, sessionManager);
new HANotifyIngressAdapter().register(app, sessionManager);
new WeComIngressAdapter().register(app, sessionManager);
new WeComBridgeIngressAdapter().register(app, sessionManager);
new AdminIngressAdapter(envStore, scheduler, evolutionEngine, undefined, evolutionService).register(app, sessionManager);

const port = Number(process.env.PORT ?? 3000);

async function startServer() {
  try {
    console.log("Checking and installing skill dependencies...");
    await skillManager.ensureSkillsInstalled();
    console.log("Skill dependencies check completed");
    console.log("Initializing STT runtime...");
    await sttRuntime.init();
    console.log(`STT runtime ready: provider=${sttRuntime.getProviderName()}`);
    scheduler.start();
    console.log(`Scheduler started (tick=${scheduler.getTickMs()}ms)`);
    evolutionEngine.start();
    console.log(`Evolution engine started (tick=${evolutionEngine.getTickMs()}ms)`);

    app.listen(port, () => {
      console.log(`Ingress listening on :${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
