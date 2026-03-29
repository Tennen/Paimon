import { parseCommand, getEvolutionApi } from "./commands";
import {
  buildCodexHelpText,
  buildCodexStatusText,
  buildConfirmSubmitResponse,
  buildEvolutionHelpText,
  buildLogsResponse,
  buildPendingConfirmationsText,
  buildStatusResponse,
  buildTickAcceptedText
} from "./responses";
import { EvolutionRuntimeContext } from "./types";

export async function execute(input: unknown, context: EvolutionRuntimeContext): Promise<{ text: string; result?: unknown }> {
  const api = getEvolutionApi(context);
  const raw = String(input || "").trim();
  const command = parseCommand(raw);

  if (command.scope === "codex") {
    return handleCodexCommand(command, api);
  }

  if (command.kind === "help") {
    return { text: buildEvolutionHelpText() };
  }

  if (command.kind === "tick") {
    const trigger = typeof api.triggerNowAsync === "function" ? api.triggerNowAsync : api.triggerNow;
    void Promise.resolve(trigger()).catch(() => undefined);
    return { text: buildTickAcceptedText() };
  }

  if (command.kind === "status") {
    const snapshot = await Promise.resolve(api.getSnapshot());
    return { text: buildStatusResponse(snapshot, command.goalId) };
  }

  if (command.kind === "logs") {
    const snapshot = await Promise.resolve(api.getSnapshot());
    return {
      text: buildLogsResponse(snapshot, {
        goalId: command.goalId,
        keyword: command.keyword
      })
    };
  }

  if (command.kind === "confirm_status") {
    const pending = await Promise.resolve(
      typeof api.getPendingConfirmations === "function"
        ? api.getPendingConfirmations(command.goalId)
        : []
    );
    return { text: buildPendingConfirmationsText(pending, command.goalId) };
  }

  if (command.kind === "confirm_submit") {
    if (typeof api.submitConfirmation !== "function") {
      return { text: "当前版本不支持确认命令，请升级 evolution runtime。" };
    }
    const submitted = await Promise.resolve(api.submitConfirmation({
      decision: command.decision ?? "yes",
      ...(command.goalId ? { goalId: command.goalId } : {}),
      ...(command.taskId ? { taskId: command.taskId } : {})
    }));
    return {
      text: buildConfirmSubmitResponse(submitted)
    };
  }

  const created = await Promise.resolve(api.enqueueGoal({
    goal: command.goal || "",
    ...(command.commitMessage ? { commitMessage: command.commitMessage } : {})
  })) as { id?: string; status?: string; commitMessage?: string };
  const goalId = typeof created.id === "string" ? created.id : "unknown";
  const status = typeof created.status === "string" ? created.status : "pending";
  const commitMessage = typeof created.commitMessage === "string" ? created.commitMessage : "";

  return {
    text: [
      `已创建 Evolution Goal: ${goalId}`,
      `状态: ${status}`,
      commitMessage ? `commit: ${commitMessage}` : "",
      "可用指令：/evolve status | /evolve tick | /codex status"
    ]
      .filter(Boolean)
      .join("\n")
  };
}

async function handleCodexCommand(
  command: ReturnType<typeof parseCommand>,
  api: ReturnType<typeof getEvolutionApi>
): Promise<{ text: string }> {
  if (command.kind === "help") {
    return { text: buildCodexHelpText() };
  }

  if (command.kind === "status") {
    const config = await Promise.resolve(api.getCodexConfig());
    return { text: buildCodexStatusText(config) };
  }

  if (command.kind === "model_get") {
    const config = await Promise.resolve(api.getCodexConfig());
    return { text: `Codex model: ${config.codexModel || "(default)"}` };
  }

  if (command.kind === "model_set") {
    const config = await Promise.resolve(api.updateCodexConfig({ model: command.model }));
    return {
      text: [
        "Codex model 已更新。",
        `当前 model: ${config.codexModel || "(default)"}`,
        `当前 reasoning effort: ${config.codexReasoningEffort || "(default)"}`
      ].join("\n")
    };
  }

  if (command.kind === "effort_get") {
    const config = await Promise.resolve(api.getCodexConfig());
    return { text: `Codex reasoning effort: ${config.codexReasoningEffort || "(default)"}` };
  }

  if (command.kind === "effort_set") {
    const config = await Promise.resolve(api.updateCodexConfig({ reasoningEffort: command.reasoningEffort }));
    return {
      text: [
        "Codex reasoning effort 已更新。",
        `当前 reasoning effort: ${config.codexReasoningEffort || "(default)"}`,
        `当前 model: ${config.codexModel || "(default)"}`
      ].join("\n")
    };
  }

  return { text: buildCodexHelpText() };
}
