import crypto from "crypto";
import { SessionManager } from "../sessionManager";
import { Envelope, Response } from "../types";
import { WeComSender } from "../wecom/sender";
import { ScheduledTask, ScheduledTaskStore } from "./taskStore";

export type CreateScheduledTaskInput = {
  name?: string;
  enabled?: boolean;
  time: string;
  toUser: string;
  message: string;
};

export type UpdateScheduledTaskInput = {
  name?: string;
  enabled?: boolean;
  time?: string;
  toUser?: string;
  message?: string;
};

export type TriggerTaskResult = {
  task: ScheduledTask;
  acceptedAsync: boolean;
  responseText: string;
  imageCount: number;
};

export class SchedulerService {
  private readonly sessionManager: SessionManager;
  private readonly sender: WeComSender;
  private readonly store: ScheduledTaskStore;
  private readonly tickMs: number;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    sessionManager: SessionManager,
    store?: ScheduledTaskStore,
    sender?: WeComSender
  ) {
    this.sessionManager = sessionManager;
    this.store = store ?? new ScheduledTaskStore();
    this.sender = sender ?? new WeComSender();
    this.tickMs = normalizeTickMs(process.env.SCHEDULE_TICK_MS);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.enqueueRun(() => this.tick());
    }, this.tickMs);
    this.enqueueRun(() => this.tick());
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  getStorePath(): string {
    return this.store.getPath();
  }

  getTickMs(): number {
    return this.tickMs;
  }

  getTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  }

  listTasks(): ScheduledTask[] {
    return this.store.list();
  }

  createTask(input: CreateScheduledTaskInput): ScheduledTask {
    const payload = normalizeCreateInput(input);
    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: createTaskId(),
      name: payload.name,
      enabled: payload.enabled,
      type: "daily",
      time: payload.time,
      toUser: payload.toUser,
      message: payload.message,
      createdAt: now,
      updatedAt: now
    };
    const tasks = this.store.list();
    tasks.push(task);
    this.store.save(tasks);
    return task;
  }

  updateTask(id: string, input: UpdateScheduledTaskInput): ScheduledTask | null {
    const taskId = normalizeId(id);
    if (!taskId) {
      return null;
    }

    const tasks = this.store.list();
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) {
      return null;
    }

    const next = normalizeUpdateInput(input, tasks[index]);
    const updated: ScheduledTask = {
      ...tasks[index],
      ...next,
      updatedAt: new Date().toISOString()
    };
    tasks[index] = updated;
    this.store.save(tasks);
    return updated;
  }

  deleteTask(id: string): boolean {
    const taskId = normalizeId(id);
    if (!taskId) {
      return false;
    }

    const tasks = this.store.list();
    const next = tasks.filter((task) => task.id !== taskId);
    if (next.length === tasks.length) {
      return false;
    }
    this.store.save(next);
    return true;
  }

  async runTaskNow(id: string): Promise<TriggerTaskResult> {
    const taskId = normalizeId(id);
    if (!taskId) {
      throw new Error("Invalid task id");
    }
    const task = this.store.list().find((item) => item.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    return this.executeTask(task, `manual-${Date.now()}`);
  }

  private enqueueRun(job: () => Promise<void>): void {
    const next = this.queue
      .catch(() => undefined)
      .then(job)
      .catch((error) => {
        console.error("scheduler tick failed:", error);
      });
    this.queue = next;
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();
    const tasks = this.store.list();
    const due: Array<{ task: ScheduledTask; runKey: string }> = [];

    for (const task of tasks) {
      const runKey = buildRunKey(now, task.time);
      if (!runKey) {
        continue;
      }
      if (!task.enabled) {
        continue;
      }
      if (task.lastRunKey === runKey) {
        continue;
      }
      due.push({ task, runKey });
    }

    if (due.length === 0) {
      return;
    }

    const dueIds = new Set(due.map((item) => item.task.id));
    const runKeys = new Map(due.map((item) => [item.task.id, item.runKey]));
    const marked = tasks.map((task) => {
      if (!dueIds.has(task.id)) {
        return task;
      }
      return {
        ...task,
        lastRunAt: nowIso,
        lastRunKey: runKeys.get(task.id),
        updatedAt: nowIso
      };
    });
    this.store.save(marked);

    for (const item of due) {
      try {
        await this.executeTask(item.task, item.runKey);
      } catch (error) {
        console.error(`scheduler execute failed for task ${item.task.id}:`, error);
      }
    }
  }

  private async executeTask(task: ScheduledTask, runKey: string): Promise<TriggerTaskResult> {
    const now = new Date().toISOString();
    const envelope: Envelope = {
      requestId: `schedule-${task.id}-${Date.now()}`,
      source: "scheduler",
      sessionId: task.toUser,
      kind: "text",
      text: task.message,
      meta: {
        scheduler_task_id: task.id,
        scheduler_run_key: runKey,
        callback_to_user: task.toUser
      },
      receivedAt: now
    };

    const response = await this.sessionManager.enqueue(envelope);
    const acceptedAsync = Boolean(response.data?.asyncTask);
    if (!acceptedAsync) {
      await this.sender.sendResponse(task.toUser, response);
    }
    return {
      task,
      acceptedAsync,
      responseText: response.text ?? "",
      imageCount: countImages(response)
    };
  }
}

function normalizeTickMs(raw: string | undefined): number {
  const value = Number(raw ?? "15000");
  if (!Number.isFinite(value) || value < 5000) {
    return 15000;
  }
  return Math.floor(value);
}

function normalizeCreateInput(input: CreateScheduledTaskInput): {
  name: string;
  enabled: boolean;
  time: string;
  toUser: string;
  message: string;
} {
  const name = normalizeName(input.name);
  const enabled = input.enabled ?? true;
  const time = normalizeTime(input.time);
  const toUser = normalizeRequiredText(input.toUser, "toUser");
  const message = normalizeRequiredText(input.message, "message");
  return { name, enabled, time, toUser, message };
}

function normalizeUpdateInput(input: UpdateScheduledTaskInput, current: ScheduledTask): {
  name: string;
  enabled: boolean;
  time: string;
  toUser: string;
  message: string;
} {
  const name = normalizeName(input.name ?? current.name);
  const enabled = input.enabled ?? current.enabled;
  const time = normalizeTime(input.time ?? current.time);
  const toUser = normalizeRequiredText(input.toUser ?? current.toUser, "toUser");
  const message = normalizeRequiredText(input.message ?? current.message, "message");
  return { name, enabled, time, toUser, message };
}

function normalizeName(raw: string | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text) {
    return "untitled";
  }
  return text.slice(0, 100);
}

function normalizeTime(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) {
    throw new Error("time must be HH:mm");
  }
  const [hour, minute] = text.split(":").map((part) => Number(part));
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("time must be HH:mm");
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeRequiredText(raw: string, field: string): string {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  return text;
}

function buildRunKey(now: Date, taskTime: string): string {
  const time = tryNormalizeTime(taskTime);
  if (!time) {
    return "";
  }
  const [hour, minute] = time.split(":").map((part) => Number(part));
  if (now.getHours() !== hour || now.getMinutes() !== minute) {
    return "";
  }
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${time}`;
}

function tryNormalizeTime(raw: string): string | null {
  try {
    return normalizeTime(raw);
  } catch {
    return null;
  }
}

function countImages(response: Response): number {
  const fromList = Array.isArray(response.data?.images) ? response.data?.images.length : 0;
  const hasSingle = response.data?.image ? 1 : 0;
  return Math.max(fromList, hasSingle);
}

function createTaskId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeId(value: string): string {
  return String(value ?? "").trim();
}
