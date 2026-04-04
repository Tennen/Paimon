import { EnvConfigStore } from "../../config/envConfigStore";
import { ConversationBenchmarkService } from "../../core/conversation/benchmarkService";
import { SchedulerService } from "../../scheduler/schedulerService";
import { CodexConfigService } from "../../integrations/codex/configService";
import { EvolutionOperatorService } from "../../integrations/evolution-operator/service";
import { ObservableMenuService } from "../../observable/menuService";
import { DirectInputMappingService } from "../../config/directInputMappingService";
import { OpenAIQuotaManager } from "../../integrations/openai/quotaManager";
import { ConversationContextService } from "../../config/conversationContextService";
import { SkillManager } from "../../skills/skillManager";
import { ToolRegistry } from "../../tools/toolRegistry";

export type AdminRouteContext = {
  envStore: EnvConfigStore;
  scheduler: SchedulerService;
  codexConfigService: CodexConfigService;
  evolutionService?: EvolutionOperatorService;
  adminDistCandidates: string[];
  openAIQuotaManager: OpenAIQuotaManager;
  observableMenuService: ObservableMenuService;
  directInputMappingService: DirectInputMappingService;
  conversationContextService: ConversationContextService;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  conversationBenchmarkService?: ConversationBenchmarkService;
};
