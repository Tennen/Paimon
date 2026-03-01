import crypto from "crypto";
import { SessionManager } from "../core/sessionManager";
import { Envelope, Response } from "../types";
import { WeComSender } from "../integrations/wecom/sender";
import { ScheduledTask, ScheduledTaskStore } from "./taskStore";
import { PushUser, PushUserStore } from "./userStore";
import { DataStoreDescriptor } from "../storage/persistence";

export type CreatePushUserInput = {
  name: string;
  wecomUserId: string;
  enabled?: boolean;
};

export type UpdatePushUserInput = {
  name?: string;
  wecomUserId?: string;
  enabled?: boolean;
};

export type CreateScheduledTaskInput = {
  name?: string;
  enabled?: boolean;
  time: string;
  userId: string;
  message: string;
};

export type UpdateScheduledTaskInput = {
  name?: string;
  enabled?: boolean;
  time?: string;
  userId?: string;
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
  private readonly userStore: PushUserStore;
  private readonly tickMs: number;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    sessionManager: SessionManager,
    store?: ScheduledTaskStore,
    sender?: WeComSender,
    userStore?: PushUserStore
  ) {
    this.sessionManager = sessionManager;
    this.store = store ?? new ScheduledTaskStore();
    this.sender = sender ?? new WeComSender();
    this.userStore = userStore ?? new PushUserStore();
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

  getTaskStore(): DataStoreDescriptor {
    return this.store.getStore();
  }

  getUserStore(): DataStoreDescriptor {
    return this.userStore.getStore();
  }

  getTickMs(): number {
    return this.tickMs;
  }

  getTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  }

  listUsers(): PushUser[] {
    return this.userStore.list();
  }

  createUser(input: CreatePushUserInput): PushUser {
    const payload = normalizeCreateUserInput(input);
    const users = this.userStore.list();
    ensureUniqueWecomUserId(users, payload.wecomUserId);

    const now = new Date().toISOString();
    const user: PushUser = {
      id: createEntityId("user"),
      name: payload.name,
      wecomUserId: payload.wecomUserId,
      enabled: payload.enabled,
      createdAt: now,
      updatedAt: now
    };
    users.push(user);
    this.userStore.save(users);
    return user;
  }

  updateUser(id: string, input: UpdatePushUserInput): PushUser | null {
    const userId = normalizeId(id);
    if (!userId) {
      return null;
    }

    const users = this.userStore.list();
    const index = users.findIndex((item) => item.id === userId);
    if (index < 0) {
      return null;
    }

    const next = normalizeUpdateUserInput(input, users[index]);
    ensureUniqueWecomUserId(users, next.wecomUserId, userId);

    const updated: PushUser = {
      ...users[index],
      ...next,
      updatedAt: new Date().toISOString()
    };
    users[index] = updated;
    this.userStore.save(users);
    this.syncTaskTargetsForUser(updated);

    return updated;
  }

  deleteUser(id: string): boolean {
    const userId = normalizeId(id);
    if (!userId) {
      return false;
    }

    const users = this.userStore.list();
    const next = users.filter((item) => item.id !== userId);
    if (next.length === users.length) {
      return false;
    }

    this.userStore.save(next);
    return true;
  }

  listTasks(): ScheduledTask[] {
    return this.store.list();
  }

  createTask(input: CreateScheduledTaskInput): ScheduledTask {
    const payload = normalizeCreateTaskInput(input);
    const user = this.getRequiredUser(payload.userId);

    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: createEntityId("task"),
      name: payload.name,
      enabled: payload.enabled,
      type: "daily",
      time: payload.time,
      userId: user.id,
      toUser: user.wecomUserId,
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

    const next = normalizeUpdateTaskInput(input, tasks[index]);
    const user = this.getRequiredUser(next.userId);

    const updated: ScheduledTask = {
      ...tasks[index],
      ...next,
      userId: user.id,
      toUser: user.wecomUserId,
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

  async runMessageNow(userId: string, message: string): Promise<TriggerTaskResult> {
    const user = this.getRequiredUser(userId);
    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: createEntityId("task-once"),
      name: "run-once",
      enabled: true,
      type: "daily",
      time: "00:00",
      userId: user.id,
      toUser: user.wecomUserId,
      message: normalizeRequiredText(message, "message"),
      createdAt: now,
      updatedAt: now
    };
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
    const users = this.userStore.list();
    const userMap = new Map(users.map((user) => [user.id, user]));
    const due: Array<{ task: ScheduledTask; runKey: string }> = [];

    for (const task of tasks) {
      const runKey = buildRunKey(now, task.time);
      if (!runKey || !task.enabled || task.lastRunKey === runKey) {
        continue;
      }

      if (!canTaskRun(task, userMap)) {
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
    const toUser = this.resolveTaskToUser(task);

    const envelope: Envelope = {
      requestId: `schedule-${task.id}-${Date.now()}`,
      source: "scheduler",
      sessionId: toUser,
      kind: "text",
      text: task.message,
      meta: {
        scheduler_task_id: task.id,
        scheduler_run_key: runKey,
        callback_to_user: toUser
      },
      receivedAt: now
    };

    const response = await this.sessionManager.enqueue(envelope);
    const acceptedAsync = Boolean(response.data?.asyncTask);
    if (!acceptedAsync) {
      await this.sender.sendResponse(toUser, response);
    }

    return {
      task,
      acceptedAsync,
      responseText: response.text ?? "",
      imageCount: countImages(response)
    };
  }

  private getRequiredUser(userId: string): PushUser {
    const targetId = normalizeRequiredText(userId, "userId");
    const user = this.userStore.list().find((item) => item.id === targetId);
    if (!user) {
      throw new Error("Selected user does not exist");
    }
    return user;
  }

  private resolveTaskToUser(task: ScheduledTask): string {
    if (task.userId) {
      const user = this.userStore.list().find((item) => item.id === task.userId);
      if (user && user.enabled) {
        return user.wecomUserId;
      }
    }

    if (task.toUser) {
      return task.toUser;
    }

    throw new Error(`Task ${task.id} has no valid push target`);
  }

  private syncTaskTargetsForUser(user: PushUser): void {
    const tasks = this.store.list();
    let changed = false;
    const now = new Date().toISOString();

    const next = tasks.map((task) => {
      if (task.userId !== user.id) {
        return task;
      }
      if (task.toUser === user.wecomUserId) {
        return task;
      }
      changed = true;
      return {
        ...task,
        toUser: user.wecomUserId,
        updatedAt: now
      };
    });

    if (changed) {
      this.store.save(next);
    }
  }
}

function normalizeTickMs(raw: string | undefined): number {
  const value = Number(raw ?? "15000");
  if (!Number.isFinite(value) || value < 5000) {
    return 15000;
  }
  return Math.floor(value);
}

function normalizeCreateUserInput(input: CreatePushUserInput): {
  name: string;
  wecomUserId: string;
  enabled: boolean;
} {
  return {
    name: normalizeName(input.name),
    wecomUserId: normalizeRequiredText(input.wecomUserId, "wecomUserId"),
    enabled: input.enabled ?? true
  };
}

function normalizeUpdateUserInput(input: UpdatePushUserInput, current: PushUser): {
  name: string;
  wecomUserId: string;
  enabled: boolean;
} {
  return {
    name: normalizeName(input.name ?? current.name),
    wecomUserId: normalizeRequiredText(input.wecomUserId ?? current.wecomUserId, "wecomUserId"),
    enabled: input.enabled ?? current.enabled
  };
}

function normalizeCreateTaskInput(input: CreateScheduledTaskInput): {
  name: string;
  enabled: boolean;
  time: string;
  userId: string;
  message: string;
} {
  return {
    name: normalizeName(input.name),
    enabled: input.enabled ?? true,
    time: normalizeTime(input.time),
    userId: normalizeRequiredText(input.userId, "userId"),
    message: normalizeRequiredText(input.message, "message")
  };
}

function normalizeUpdateTaskInput(input: UpdateScheduledTaskInput, current: ScheduledTask): {
  name: string;
  enabled: boolean;
  time: string;
  userId: string;
  message: string;
} {
  return {
    name: normalizeName(input.name ?? current.name),
    enabled: input.enabled ?? current.enabled,
    time: normalizeTime(input.time ?? current.time),
    userId: normalizeRequiredText(input.userId ?? current.userId ?? "", "userId"),
    message: normalizeRequiredText(input.message ?? current.message, "message")
  };
}

function ensureUniqueWecomUserId(users: PushUser[], wecomUserId: string, excludeUserId?: string): void {
  const exists = users.some((user) => user.wecomUserId === wecomUserId && user.id !== excludeUserId);
  if (exists) {
    throw new Error("wecomUserId already exists");
  }
}

function canTaskRun(task: ScheduledTask, userMap: Map<string, PushUser>): boolean {
  if (!task.userId) {
    return Boolean(task.toUser);
  }

  const user = userMap.get(task.userId);
  if (!user) {
    return Boolean(task.toUser);
  }

  return user.enabled;
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
  const fromList = Array.isArray(response.data?.images) ? response.data.images.length : 0;
  const hasSingle = response.data?.image ? 1 : 0;
  return Math.max(fromList, hasSingle);
}

function createEntityId(prefix: string): string {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeId(value: string): string {
  return String(value ?? "").trim();
}
