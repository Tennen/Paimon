import fs from "fs";
import path from "path";

export type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  type: "daily";
  time: string;
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
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = path.resolve(process.cwd(), filePath ?? process.env.SCHEDULE_TASKS_FILE ?? "data/scheduled-tasks.json");
    this.ensureFile();
  }

  getPath(): string {
    return this.filePath;
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

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.write({ version: 1, tasks: [] });
    }
  }

  private read(): TaskFile {
    this.ensureFile();
    const raw = fs.readFileSync(this.filePath, "utf-8").trim();
    if (!raw) {
      return { version: 1, tasks: [] };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<TaskFile>;
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter(isScheduledTask) : [];
      return { version: 1, tasks };
    } catch {
      return { version: 1, tasks: [] };
    }
  }

  private write(payload: TaskFile): void {
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
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
    typeof task.toUser === "string" &&
    typeof task.message === "string" &&
    typeof task.createdAt === "string" &&
    typeof task.updatedAt === "string"
  );
}
