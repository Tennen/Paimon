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
  userIds: string[];
  message: string;
};

export type UpdateScheduledTaskInput = {
  name?: string;
  enabled?: boolean;
  time?: string;
  userIds?: string[];
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
    const users = this.getRequiredUsers(payload.userIds);
    const targetUserIds = users.map((user) => user.id);
    const toUser = formatToUserTargets(users.map((user) => user.wecomUserId));

    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: createEntityId("task"),
      name: payload.name,
      enabled: payload.enabled,
      type: "daily",
      time: payload.time,
      userIds: targetUserIds,
      toUser,
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
    const users = this.getRequiredUsers(next.userIds);
    const targetUserIds = users.map((user) => user.id);
    const toUser = formatToUserTargets(users.map((user) => user.wecomUserId));

    const updated: ScheduledTask = {
      ...tasks[index],
      ...next,
      userIds: targetUserIds,
      toUser,
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
      userIds: [user.id],
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
    const targets = this.resolveTaskTargets(task);
    const toUser = formatToUserTargets(targets);

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

  private getRequiredUsers(userIds: string[]): PushUser[] {
    const users = this.userStore.list();
    const userMap = new Map(users.map((user) => [user.id, user]));
    return userIds.map((userId) => {
      const user = userMap.get(userId);
      if (!user) {
        throw new Error(`Selected user does not exist: ${userId}`);
      }
      return user;
    });
  }

  private resolveTaskTargets(task: ScheduledTask): string[] {
    const users = this.userStore.list();
    const userMap = new Map(users.map((user) => [user.id, user]));
    const userIds = getTaskUserIds(task);

    if (userIds.length > 0) {
      let hasMappedUser = false;
      const activeTargets: string[] = [];
      for (const userId of userIds) {
        const user = userMap.get(userId);
        if (!user) {
          continue;
        }
        hasMappedUser = true;
        if (!user.enabled) {
          continue;
        }
        activeTargets.push(user.wecomUserId);
      }

      const deduped = dedupeTextList(activeTargets);
      if (deduped.length > 0) {
        return deduped;
      }

      if (hasMappedUser) {
        throw new Error(`Task ${task.id} has no enabled push target`);
      }
    }

    const fallback = parseToUserTargets(task.toUser);
    if (fallback.length > 0) {
      return fallback;
    }

    throw new Error(`Task ${task.id} has no valid push target`);
  }

  private syncTaskTargetsForUser(user: PushUser): void {
    const tasks = this.store.list();
    const users = this.userStore.list();
    const userMap = new Map(users.map((item) => [item.id, item]));
    let changed = false;
    const now = new Date().toISOString();

    const next = tasks.map((task) => {
      const taskUserIds = getTaskUserIds(task);
      if (!taskUserIds.includes(user.id)) {
        return task;
      }

      const nextToUser = formatToUserTargets(resolveTaskToUsersForStorage(task, userMap));
      if (task.toUser === nextToUser) {
        return task;
      }
      changed = true;
      return {
        ...task,
        toUser: nextToUser,
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
  userIds: string[];
  message: string;
} {
  return {
    name: normalizeName(input.name),
    enabled: input.enabled ?? true,
    time: normalizeTime(input.time),
    userIds: normalizeCreateTaskUserIds(input),
    message: normalizeRequiredText(input.message, "message")
  };
}

function normalizeUpdateTaskInput(input: UpdateScheduledTaskInput, current: ScheduledTask): {
  name: string;
  enabled: boolean;
  time: string;
  userIds: string[];
  message: string;
} {
  return {
    name: normalizeName(input.name ?? current.name),
    enabled: input.enabled ?? current.enabled,
    time: normalizeTime(input.time ?? current.time),
    userIds: normalizeUpdateTaskUserIds(input, current),
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
  const userIds = getTaskUserIds(task);
  if (userIds.length === 0) {
    return parseToUserTargets(task.toUser).length > 0;
  }

  let hasMappedUser = false;
  for (const userId of userIds) {
    const user = userMap.get(userId);
    if (!user) {
      continue;
    }
    hasMappedUser = true;
    if (user.enabled && normalizeId(user.wecomUserId).length > 0) {
      return true;
    }
  }

  if (hasMappedUser) {
    return false;
  }

  return parseToUserTargets(task.toUser).length > 0;
}

function normalizeCreateTaskUserIds(input: CreateScheduledTaskInput): string[] {
  const userIds = normalizeUserIdArray(input.userIds);
  if (userIds.length === 0) {
    throw new Error("userIds is required");
  }
  return userIds;
}

function normalizeUpdateTaskUserIds(input: UpdateScheduledTaskInput, current: ScheduledTask): string[] {
  const hasUserIds = Object.prototype.hasOwnProperty.call(input, "userIds");

  if (!hasUserIds) {
    const existing = getTaskUserIds(current);
    if (existing.length > 0) {
      return existing;
    }
    throw new Error("userIds is required");
  }

  const userIds = normalizeUserIdArray(input.userIds);
  if (userIds.length === 0) {
    throw new Error("userIds is required");
  }
  return userIds;
}

function getTaskUserIds(task: ScheduledTask): string[] {
  return normalizeUserIdArray(task.userIds);
}

function resolveTaskToUsersForStorage(task: ScheduledTask, userMap: Map<string, PushUser>): string[] {
  const userIds = getTaskUserIds(task);
  if (userIds.length === 0) {
    return parseToUserTargets(task.toUser);
  }

  const mapped = userIds
    .map((userId) => userMap.get(userId)?.wecomUserId ?? "")
    .filter((value) => value.trim().length > 0);
  if (mapped.length > 0) {
    return dedupeTextList(mapped);
  }
  return parseToUserTargets(task.toUser);
}

function normalizeUserIdArray(userIds: string[] | undefined): string[] {
  if (!Array.isArray(userIds)) {
    return [];
  }
  return dedupeTextList(
    userIds
      .map((value) => normalizeId(value))
      .filter((value) => value.length > 0)
  );
}

function splitDelimitedValues(raw: string | undefined): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  const text = raw.trim();
  if (!text) {
    return [];
  }
  return text
    .split(/[|,]/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseToUserTargets(raw: string): string[] {
  return dedupeTextList(splitDelimitedValues(raw));
}

function formatToUserTargets(users: string[]): string {
  return dedupeTextList(users).join("|");
}

function dedupeTextList(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
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
