import {
  DATA_STORE,
  DataStoreDescriptor,
  getStore,
  registerStore,
  setStore
} from "../storage/persistence";

export type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  type: "daily";
  time: string;
  userId?: string;
  toUser: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunKey?: string;
};

type TaskFile = {
  version: 1;
  tasks: ScheduledTask[];
};

export class ScheduledTaskStore {
  private readonly storeName = DATA_STORE.SCHEDULER_TASKS;
  private readonly store: DataStoreDescriptor;

  constructor() {
    this.store = registerStore(this.storeName, () => ({ version: 1, tasks: [] }));
  }

  getStore(): DataStoreDescriptor {
    return this.store;
  }

  list(): ScheduledTask[] {
    return this.read().tasks.map((task) => ({ ...task }));
  }

  save(tasks: ScheduledTask[]): void {
    const payload: TaskFile = {
      version: 1,
      tasks: tasks.map((task) => ({ ...task }))
    };
    this.write(payload);
  }

  private read(): TaskFile {
    const parsed = getStore<Partial<TaskFile>>(this.storeName);
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter(isScheduledTask) : [];
    return { version: 1, tasks };
  }

  private write(payload: TaskFile): void {
    setStore(this.storeName, payload);
  }
}

function isScheduledTask(value: unknown): value is ScheduledTask {
  if (!value || typeof value !== "object") {
    return false;
  }
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === "string" &&
    typeof task.name === "string" &&
    typeof task.enabled === "boolean" &&
    task.type === "daily" &&
    typeof task.time === "string" &&
    (task.userId === undefined || typeof task.userId === "string") &&
    typeof task.toUser === "string" &&
    typeof task.message === "string" &&
    typeof task.createdAt === "string" &&
    typeof task.updatedAt === "string"
  );
}
