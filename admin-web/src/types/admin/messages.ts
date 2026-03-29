export type PushUser = {
  id: string;
  name: string;
  wecomUserId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  type: "daily";
  time: string;
  userIds: string[];
  toUser: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunKey?: string;
};

export type UserFormState = {
  name: string;
  wecomUserId: string;
  enabled: boolean;
};

export type TaskFormState = {
  name: string;
  time: string;
  userIds: string[];
  message: string;
  enabled: boolean;
};
