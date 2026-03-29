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
  task: import("./taskStore").ScheduledTask;
  acceptedAsync: boolean;
  responseText: string;
  imageCount: number;
};
