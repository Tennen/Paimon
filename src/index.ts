import "dotenv/config";
import express from "express";
import { SessionManager } from "./core/sessionManager";
import { Orchestrator } from "./core/orchestrator";
import { ToolRouter } from "./tools/toolRouter";
import { createLLMEngine, readLLMProviderStore } from "./engines/llm";
import type { LLMExecutionStep } from "./engines/llm/llm";
import { HttpIngressAdapter } from "./ingress/http";
import { HANotifyIngressAdapter } from "./ingress/haNotify";
import { WeComIngressAdapter } from "./ingress/wecom";
import { WeComBridgeIngressAdapter } from "./ingress/wecomBridge";
import { MemoryStore } from "./memory/memoryStore";
import { RawMemoryStore } from "./memory/rawMemoryStore";
import { SummaryMemoryStore } from "./memory/summaryMemoryStore";
import { SummaryVectorIndex } from "./memory/summaryVectorIndex";
import { MemoryCompactor } from "./memory/memoryCompactor";
import { HybridMemoryService } from "./memory/hybridMemoryService";
import { ConversationWindowService } from "./memory/conversationWindowService";
import { SkillManager } from "./skills/skillManager";
import { ToolRegistry, loadTools } from "./tools/toolRegistry";
import { CallbackDispatcher } from "./integrations/wecom/callbackDispatcher";
import { EnvConfigStore } from "./config/envConfigStore";
import { SchedulerService } from "./scheduler/schedulerService";
import { AdminIngressAdapter } from "./ingress/admin";
import { EvolutionEngine } from "./integrations/evolution-operator/evolutionEngine";
import { CodexConfigService } from "./integrations/codex/configService";
import { EvolutionOperatorService } from "./integrations/evolution-operator/service";
import { sttRuntime } from "./engines/stt";
import { registerSystemShortcuts } from "./core/systemShortcuts";
import { ObservableMenuService } from "./observable/menuService";
import { DirectInputMappingService } from "./config/directInputMappingService";
import { ConversationBenchmarkService } from "./core/conversation/benchmarkService";

const app = express();
app.use(express.json({ limit: "1mb" }));


const skillManager = new SkillManager();
const memoryStore = new MemoryStore();
const rawMemoryStore = new RawMemoryStore();
const summaryMemoryStore = new SummaryMemoryStore();
const summaryVectorIndex = new SummaryVectorIndex();
const memoryCompactor = new MemoryCompactor({
  rawStore: rawMemoryStore,
  summaryStore: summaryMemoryStore,
  summaryVectorIndex
});
const hybridMemoryService = new HybridMemoryService({
  rawStore: rawMemoryStore,
  summaryVectorIndex
});
const conversationWindowService = new ConversationWindowService();
const envStore = new EnvConfigStore();
const evolutionEngine = new EvolutionEngine();
const codexConfigService = new CodexConfigService(envStore);
const evolutionService = new EvolutionOperatorService(evolutionEngine, codexConfigService);
const observableMenuService = new ObservableMenuService();
const directInputMappingService = new DirectInputMappingService();

const registry = new ToolRegistry();
loadTools(registry, { skillManager, evolutionService });
registerSystemShortcuts(registry);
const toolRouter = new ToolRouter(registry);
const llmEngine = createLLMEngine();
const mainFlowLLMResolver = (step: LLMExecutionStep) => {
  const store = readLLMProviderStore();
  const providerId = step === "routing"
    ? store.routingProviderId || store.defaultProviderId
    : store.planningProviderId || store.defaultProviderId;
  return createLLMEngine(providerId);
};
const callbackDispatcher = new CallbackDispatcher();
const orchestrator = new Orchestrator(
  toolRouter,
  llmEngine,
  memoryStore,
  skillManager,
  registry,
  callbackDispatcher,
  rawMemoryStore,
  memoryCompactor,
  hybridMemoryService,
  mainFlowLLMResolver,
  observableMenuService,
  directInputMappingService,
  conversationWindowService
);
const sessionManager = new SessionManager(orchestrator);
const conversationBenchmarkService = new ConversationBenchmarkService({
  sessionManager,
  memoryStore,
  rawMemoryStore,
  summaryMemoryStore,
  summaryVectorIndex,
  windowService: conversationWindowService
});
const scheduler = new SchedulerService(sessionManager);

new HttpIngressAdapter().register(app, sessionManager);
new HANotifyIngressAdapter().register(app, sessionManager);
new WeComIngressAdapter().register(app, sessionManager);
new WeComBridgeIngressAdapter().register(app, sessionManager);
new AdminIngressAdapter(
  envStore,
  scheduler,
  evolutionEngine,
  undefined,
  evolutionService,
  conversationBenchmarkService
).register(app, sessionManager);

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
