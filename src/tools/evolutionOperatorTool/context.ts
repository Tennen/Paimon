import { ToolResult } from "../../types";
import { EvolutionRuntimeContext, EvolutionServiceBridge } from "./types";

export function buildEvolutionContext(
  context: Record<string, unknown>,
  evolutionService?: EvolutionServiceBridge
): EvolutionRuntimeContext {
  if (!evolutionService) {
    return { ...context };
  }

  return {
    ...context,
    evolution: {
      getTickMs: () => evolutionService.getTickMs(),
      getSnapshot: () => evolutionService.getSnapshot(),
      enqueueGoal: (input: { goal: string; commitMessage?: string }) => evolutionService.enqueueGoal(input),
      triggerNow: () => evolutionService.triggerNow(),
      triggerNowAsync: () => evolutionService.triggerNowAsync?.(),
      listPendingCodexApprovals: (goalId?: string) => evolutionService.listPendingCodexApprovals?.(goalId) ?? [],
      submitCodexApproval: (input: {
        decision: "yes" | "no";
        goalId?: string;
        taskId?: string;
      }) => evolutionService.submitCodexApproval?.(input) ?? { ok: false, message: "当前版本不支持确认命令" },
      getCodexConfig: () => evolutionService.getCodexConfig(),
      updateCodexConfig: (input: { model?: string; reasoningEffort?: string }) =>
        evolutionService.updateCodexConfig(input)
    }
  };
}

export async function executeInputTool(
  op: string,
  args: Record<string, unknown>,
  runner: (input: string) => Promise<unknown>
): Promise<ToolResult> {
  if (op !== "execute") {
    return { ok: false, error: `Unsupported action: ${op}` };
  }

  const input = String(args.input ?? "").trim();
  if (!input) {
    return { ok: false, error: "Missing input" };
  }

  try {
    const output = await runner(input);
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
