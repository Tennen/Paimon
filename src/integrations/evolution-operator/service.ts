import { EvolutionEngine } from "./evolutionEngine";
import { EvolutionSnapshot } from "./types";
import { CodexConfigSnapshot, CodexConfigService, UpdateCodexConfigInput } from "../codex/configService";

export type EnqueueEvolutionGoalInput = {
  goal: string;
  commitMessage?: string;
};

export class EvolutionOperatorService {
  private readonly engine: EvolutionEngine;
  private readonly codexConfig: CodexConfigService;

  constructor(engine: EvolutionEngine, codexConfig: CodexConfigService) {
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

  triggerNowAsync(): void {
    this.engine.triggerNowAsync();
  }

  listPendingCodexApprovals(goalId?: string): Array<{ taskId: string; at: string; prompt: string; goalId?: string }> {
    return this.engine.listPendingCodexApprovals(goalId);
  }

  submitCodexApproval(input: {
    decision: "yes" | "no";
    goalId?: string;
    taskId?: string;
  }): { ok: boolean; message: string; taskId?: string; goalId?: string } {
    return this.engine.submitCodexApproval(input);
  }

  getCodexConfig(): CodexConfigSnapshot {
    return this.codexConfig.getConfig();
  }

  updateCodexConfig(input: UpdateCodexConfigInput): CodexConfigSnapshot {
    return this.codexConfig.updateConfig(input);
  }
}
