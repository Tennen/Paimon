import {
  DATA_STORE,
  DataStoreDescriptor,
  getStore,
  registerStore,
  setStore
} from "../storage/persistence";

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
  private readonly storeName = DATA_STORE.SCHEDULER_USERS;
  private readonly store: DataStoreDescriptor;

  constructor() {
    this.store = registerStore(this.storeName, () => ({ version: 1, users: [] }));
  }

  getStore(): DataStoreDescriptor {
    return this.store;
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

  private read(): UserFile {
    const parsed = getStore<Partial<UserFile>>(this.storeName);
    const users = Array.isArray(parsed.users) ? parsed.users.filter(isPushUser) : [];
    return { version: 1, users };
  }

  private write(payload: UserFile): void {
    setStore(this.storeName, payload);
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
