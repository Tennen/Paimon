import crypto from "crypto";
import { Response } from "../types";
import { ScheduledTask } from "./taskStore";
import { PushUser } from "./userStore";
import {
  CreatePushUserInput,
  CreateScheduledTaskInput,
  UpdatePushUserInput,
  UpdateScheduledTaskInput
} from "./types";

export function normalizeTickMs(raw: string | undefined): number {
  const value = Number(raw ?? "15000");
  if (!Number.isFinite(value) || value < 5000) {
    return 15000;
  }
  return Math.floor(value);
}

export function normalizeCreateUserInput(input: CreatePushUserInput): {
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

export function normalizeUpdateUserInput(input: UpdatePushUserInput, current: PushUser): {
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

export function normalizeCreateTaskInput(input: CreateScheduledTaskInput): {
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

export function normalizeUpdateTaskInput(input: UpdateScheduledTaskInput, current: ScheduledTask): {
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

export function ensureUniqueWecomUserId(users: PushUser[], wecomUserId: string, excludeUserId?: string): void {
  const exists = users.some((user) => user.wecomUserId === wecomUserId && user.id !== excludeUserId);
  if (exists) {
    throw new Error("wecomUserId already exists");
  }
}

export function canTaskRun(task: ScheduledTask, userMap: Map<string, PushUser>): boolean {
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

export function getTaskUserIds(task: ScheduledTask): string[] {
  return normalizeUserIdArray(task.userIds);
}

export function resolveTaskToUsersForStorage(task: ScheduledTask, userMap: Map<string, PushUser>): string[] {
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

export function parseToUserTargets(raw: string): string[] {
  return dedupeTextList(splitDelimitedValues(raw));
}

export function formatToUserTargets(users: string[]): string {
  return dedupeTextList(users).join("|");
}

export function buildRunKey(now: Date, taskTime: string): string {
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

export function countImages(response: Response): number {
  const fromList = Array.isArray(response.data?.images) ? response.data.images.length : 0;
  const hasSingle = response.data?.image ? 1 : 0;
  return Math.max(fromList, hasSingle);
}

export function createEntityId(prefix: string): string {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeId(value: string): string {
  return String(value ?? "").trim();
}

export function normalizeRequiredText(raw: string, field: string): string {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  return text;
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

export function dedupeTextList(values: string[]): string[] {
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

function tryNormalizeTime(raw: string): string | null {
  try {
    return normalizeTime(raw);
  } catch {
    return null;
  }
}
