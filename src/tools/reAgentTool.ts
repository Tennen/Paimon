import { isReAgentCommandInput, parseReAgentCommand, withReAgentPrefix } from "../core/re-agent";
import { ReAgentMemoryStore } from "../memory/reAgentMemoryStore";
import { ReAgentRawMemoryStore } from "../memory/reAgentRawMemoryStore";
import { ReAgentSummaryMemoryStore } from "../memory/reAgentSummaryMemoryStore";
import { ReAgentSummaryVectorIndex } from "../memory/reAgentSummaryVectorIndex";
import { ToolResult } from "../types";
import { DirectShortcutContext, ToolDependencies, ToolRegistry } from "./toolRegistry";

type ReAgentRuntimeBridge = {
  run: (input: { sessionId: string; input: string; maxSteps?: number }) => Promise<{ response: string }>;
  resetSession?: (sessionId: string) => void | Promise<void>;
};

export function registerTool(registry: ToolRegistry, deps: ToolDependencies): void {
  const runtime = deps.reAgentRuntime as ReAgentRuntimeBridge | undefined;

  registry.registerDirectShortcut({
    command: "/re",
    execute: async (context) => executeReAgentShortcut(runtime, context)
  });
}

async function executeReAgentShortcut(
  runtime: ReAgentRuntimeBridge | undefined,
  context: DirectShortcutContext
): Promise<ToolResult> {
  const parsed = parseReAgentCommand(context.input);

  if (parsed.kind === "help") {
    return {
      ok: true,
      output: {
        text: buildReAgentHelpText()
      }
    };
  }

  if (parsed.kind === "reset") {
    await resetReAgentMemory(context.sessionId, runtime);
    return {
      ok: true,
      output: {
        text: withReAgentPrefix("会话记忆已重置。")
      }
    };
  }

  if (!runtime) {
    return {
      ok: true,
      output: {
        text: withReAgentPrefix("子 agent runtime 未配置。")
      }
    };
  }

  try {
    const result = await runtime.run({
      sessionId: context.sessionId,
      input: parsed.content
    });
    return {
      ok: true,
      output: {
        text: toReAgentReply(result.response)
      }
    };
  } catch (error) {
    return {
      ok: true,
      output: {
        text: withReAgentPrefix(`子 agent 执行失败: ${(error as Error).message}`)
      }
    };
  }
}

function toReAgentReply(text: string): string {
  const value = String(text ?? "").trim();
  if (!value) {
    return withReAgentPrefix("暂时无法完成该请求。");
  }
  return isReAgentCommandInput(value) ? value : withReAgentPrefix(value);
}

function buildReAgentHelpText(): string {
  return [
    "/re 使用说明：",
    "/re <问题> 触发子 agent 对话",
    "/re help 查看帮助",
    "/re reset 重置子 agent 会话记忆"
  ].join("\n");
}

async function resetReAgentMemory(sessionId: string, runtime?: ReAgentRuntimeBridge): Promise<void> {
  const key = String(sessionId ?? "").trim();
  if (!key) {
    return;
  }

  if (runtime && typeof runtime.resetSession === "function") {
    await runtime.resetSession(key);
    return;
  }

  new ReAgentMemoryStore().clear(key);
  new ReAgentRawMemoryStore().clear(key);
  new ReAgentSummaryMemoryStore().clear(key);
  new ReAgentSummaryVectorIndex().clear(key);
}
