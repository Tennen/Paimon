import { EvolutionEngine } from "./evolutionEngine";
import { EvolutionSnapshot } from "./types";
import { CodexConfigSnapshot, EvolutionCodexConfigService, UpdateCodexConfigInput } from "./codexConfigService";

export type EnqueueEvolutionGoalInput = {
  goal: string;
  commitMessage?: string;
};

export class EvolutionOperatorService {
  private readonly engine: EvolutionEngine;
  private readonly codexConfig: EvolutionCodexConfigService;

  constructor(engine: EvolutionEngine, codexConfig: EvolutionCodexConfigService) {
    this.engine = engine;
    this.codexConfig = codexConfig;
  }

  getTickMs(): number {
    return this.engine.getTickMs();
  }

  getSnapshot(): EvolutionSnapshot {
    return this.engine.getSnapshot();
  }

  async enqueueGoal(input: EnqueueEvolutionGoalInput) {
    return this.engine.enqueueGoal(input);
  }

  async triggerNow(): Promise<void> {
    return this.engine.triggerNow();
  }

  getCodexConfig(): CodexConfigSnapshot {
    return this.codexConfig.getConfig();
  }

  updateCodexConfig(input: UpdateCodexConfigInput): CodexConfigSnapshot {
    return this.codexConfig.updateConfig(input);
  }
}
