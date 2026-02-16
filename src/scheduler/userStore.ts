import fs from "fs";
import path from "path";

export type PushUser = {
  id: string;
  name: string;
  wecomUserId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserFile = {
  version: 1;
  users: PushUser[];
};

export class PushUserStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = path.resolve(process.cwd(), filePath ?? process.env.PUSH_USERS_FILE ?? "data/push-users.json");
    this.ensureFile();
  }

  getPath(): string {
    return this.filePath;
  }

  list(): PushUser[] {
    return this.read().users.map((user) => ({ ...user }));
  }

  save(users: PushUser[]): void {
    const payload: UserFile = {
      version: 1,
      users: users.map((user) => ({ ...user }))
    };
    this.write(payload);
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      this.write({ version: 1, users: [] });
    }
  }

  private read(): UserFile {
    this.ensureFile();
    const raw = fs.readFileSync(this.filePath, "utf-8").trim();
    if (!raw) {
      return { version: 1, users: [] };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<UserFile>;
      const users = Array.isArray(parsed.users) ? parsed.users.filter(isPushUser) : [];
      return { version: 1, users };
    } catch {
      return { version: 1, users: [] };
    }
  }

  private write(payload: UserFile): void {
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }
}

function isPushUser(value: unknown): value is PushUser {
  if (!value || typeof value !== "object") {
    return false;
  }
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.name === "string" &&
    typeof user.wecomUserId === "string" &&
    typeof user.enabled === "boolean" &&
    typeof user.createdAt === "string" &&
    typeof user.updatedAt === "string"
  );
}
