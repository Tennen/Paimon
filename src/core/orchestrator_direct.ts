import { CallbackDispatcher } from "../integrations/wecom/callbackDispatcher";
import { Envelope, Response, ToolExecution } from "../types";
import { DirectShortcutMatch, DirectToolCallMatch, ToolRegistry } from "../tools/toolRegistry";
import {
  createAsyncTaskEnvelope,
  createAsyncTaskId,
  runDeferred,
  waitForPromiseWithTimeout
} from "./orchestrator_shared";

type ToolResultPayload = { result: { ok: boolean; output?: unknown; error?: string } };

type DirectCommandRuntimeOptions = {
  toolRegistry: ToolRegistry;
  callbackDispatcher: CallbackDispatcher;
  processed: Map<string, Response>;
  appendMemory: (envelope: Envelope, text: string, response: Response) => void;
  readSessionMemory: (sessionId: string) => string;
  toolCallStep: (
    toolExecution: ToolExecution,
    text: string,
    memory: string,
    envelope: Envelope,
    start: number
  ) => Promise<ToolResultPayload>;
  respondStep: (
    toolResult: { ok: boolean; output?: unknown; error?: string },
    successResponse: string,
    failureResponse: string,
    preferToolResult: boolean,
    text: string,
    envelope: Envelope,
    start: number
  ) => Promise<Response>;
};

export class DirectCommandRuntime {
  private readonly asyncDirectQueues = new Map<string, Promise<void>>();
  private readonly options: DirectCommandRuntimeOptions;

  constructor(options: DirectCommandRuntimeOptions) {
    this.options = options;
  }

  async handleDirectCommandRoute(
    text: string,
    envelope: Envelope,
    start: number,
    readSessionMemory: () => string,
    memoryText = text
  ): Promise<Response | null> {
    const shortcutMatched = this.options.toolRegistry.matchDirectShortcut(text);
    if (shortcutMatched) {
      if (shortcutMatched.async) {
        return this.handleAsyncDirectShortcut(shortcutMatched, text, envelope, start, memoryText);
      }

      return this.executeDirectShortcut(shortcutMatched, text, readSessionMemory(), envelope, start, memoryText);
    }

    const matched = this.options.toolRegistry.matchDirectToolCall(text);
    if (!matched) {
      return null;
    }

    if (matched.async) {
      return this.handleAsyncDirectToolCall(matched, text, envelope, start, memoryText);
    }

    const toolExecution: ToolExecution = {
      tool: matched.tool,
      op: matched.op,
      args: matched.args
    };
    const toolResult = await this.options.toolCallStep(toolExecution, text, readSessionMemory(), envelope, start);
    return this.options.respondStep(
      toolResult.result,
      "",
      "",
      matched.preferToolResult,
      memoryText,
      envelope,
      start
    );
  }

  private async handleAsyncDirectShortcut(
    matched: DirectShortcutMatch,
    text: string,
    envelope: Envelope,
    start: number,
    memoryText: string
  ): Promise<Response> {
    const taskId = createAsyncTaskId(matched.command);
    const taskEnvelope = createAsyncTaskEnvelope(envelope, taskId);
    const executionPromise = this.enqueueAsyncDirectTask(envelope.sessionId, () =>
      this.executeAsyncDirectShortcut(matched, text, envelope, taskEnvelope, Date.now(), memoryText)
    );

    try {
      const settled = await waitForPromiseWithTimeout(executionPromise, matched.acceptedDelayMs);
      if (settled.completed) {
        this.options.processed.set(envelope.requestId, settled.value.response);
        return settled.value.response;
      }
    } catch (error) {
      const fallback: Response = {
        text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
      };
      this.options.processed.set(envelope.requestId, fallback);
      this.options.appendMemory(envelope, memoryText, fallback);
      return fallback;
    }

    void executionPromise
      .then(async ({ taskEnvelope: doneEnvelope, response }) => {
        await this.options.callbackDispatcher.send(doneEnvelope, response);
      })
      .catch(async (error) => {
        const fallback: Response = {
          text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
        };
        this.options.processed.set(taskEnvelope.requestId, fallback);
        this.options.appendMemory(taskEnvelope, memoryText, fallback);
        await this.options.callbackDispatcher.send(taskEnvelope, fallback);
      });

    const acceptedResponse: Response = {
      text: matched.acceptedText || "任务已受理，正在处理中，稍后回调结果。",
      data: {
        asyncTask: {
          id: taskId,
          status: "accepted"
        }
      }
    };
    this.options.processed.set(envelope.requestId, acceptedResponse);
    this.options.appendMemory(envelope, memoryText, acceptedResponse);
    return acceptedResponse;
  }

  private async handleAsyncDirectToolCall(
    matched: DirectToolCallMatch,
    text: string,
    envelope: Envelope,
    start: number,
    memoryText: string
  ): Promise<Response> {
    const taskId = createAsyncTaskId(matched.command);
    const taskEnvelope = createAsyncTaskEnvelope(envelope, taskId);
    const executionPromise = this.enqueueAsyncDirectTask(envelope.sessionId, () =>
      this.executeAsyncDirectToolCall(matched, text, envelope, taskEnvelope, Date.now(), memoryText)
    );

    try {
      const settled = await waitForPromiseWithTimeout(executionPromise, matched.acceptedDelayMs);
      if (settled.completed) {
        this.options.processed.set(envelope.requestId, settled.value.response);
        return settled.value.response;
      }
    } catch (error) {
      const fallback: Response = {
        text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
      };
      this.options.processed.set(envelope.requestId, fallback);
      this.options.appendMemory(envelope, memoryText, fallback);
      return fallback;
    }

    void executionPromise
      .then(async ({ taskEnvelope: doneEnvelope, response }) => {
        await this.options.callbackDispatcher.send(doneEnvelope, response);
      })
      .catch(async (error) => {
        const fallback: Response = {
          text: `异步任务失败: ${(error as Error).message ?? "unknown error"}`
        };
        this.options.processed.set(taskEnvelope.requestId, fallback);
        this.options.appendMemory(taskEnvelope, memoryText, fallback);
        await this.options.callbackDispatcher.send(taskEnvelope, fallback);
      });

    const acceptedText = matched.acceptedText || "任务已受理，正在处理中，稍后回调结果。";
    const acceptedResponse: Response = {
      text: acceptedText,
      data: {
        asyncTask: {
          id: taskId,
          status: "accepted"
        }
      }
    };
    this.options.processed.set(envelope.requestId, acceptedResponse);
    this.options.appendMemory(envelope, memoryText, acceptedResponse);
    return acceptedResponse;
  }

  private enqueueAsyncDirectTask<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const prior = this.asyncDirectQueues.get(sessionId) ?? Promise.resolve();
    const running = prior
      .catch(() => undefined)
      .then(() => runDeferred(task));
    const next = running
      .then(() => undefined)
      .catch((error) => {
        console.error("async direct task failed:", error);
      });
    this.asyncDirectQueues.set(sessionId, next);
    void next.finally(() => {
      if (this.asyncDirectQueues.get(sessionId) === next) {
        this.asyncDirectQueues.delete(sessionId);
      }
    });
    return running;
  }

  private async executeAsyncDirectToolCall(
    matched: DirectToolCallMatch,
    text: string,
    envelope: Envelope,
    taskEnvelope: Envelope,
    start: number,
    memoryText = text
  ): Promise<{ taskEnvelope: Envelope; response: Response }> {
    const latestMemory = this.options.readSessionMemory(envelope.sessionId);
    const toolExecution: ToolExecution = {
      tool: matched.tool,
      op: matched.op,
      args: matched.args
    };
    const toolResult = await this.options.toolCallStep(toolExecution, text, latestMemory, taskEnvelope, start);
    const response = await this.options.respondStep(
      toolResult.result,
      "",
      "",
      matched.preferToolResult,
      memoryText,
      taskEnvelope,
      start
    );
    return { taskEnvelope, response };
  }

  private async executeDirectShortcut(
    matched: DirectShortcutMatch,
    text: string,
    memory: string,
    envelope: Envelope,
    start: number,
    memoryText = text
  ): Promise<Response> {
    const result = await matched.execute({
      command: matched.command,
      input: text,
      rest: matched.rest,
      sessionId: envelope.sessionId,
      memory
    });
    return this.options.respondStep(
      result,
      "",
      "",
      matched.preferToolResult,
      memoryText,
      envelope,
      start
    );
  }

  private async executeAsyncDirectShortcut(
    matched: DirectShortcutMatch,
    text: string,
    envelope: Envelope,
    taskEnvelope: Envelope,
    start: number,
    memoryText = text
  ): Promise<{ taskEnvelope: Envelope; response: Response }> {
    const latestMemory = this.options.readSessionMemory(envelope.sessionId);
    const response = await this.executeDirectShortcut(
      matched,
      text,
      latestMemory,
      taskEnvelope,
      start,
      memoryText
    );
    return { taskEnvelope, response };
  }
}
