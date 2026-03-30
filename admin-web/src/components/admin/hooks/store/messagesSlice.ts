import { EMPTY_TASK_FORM, EMPTY_USER_FORM } from "@/types/admin";
import type { PushUser, ScheduledTask, TaskFormState, UserFormState } from "@/types/admin";
import { request } from "../adminApi";
import type { AdminMessagesSlice, StateUpdater } from "./slices";
import type { AdminSliceCreator } from "./types";

function resolveUpdater<T>(updater: StateUpdater<T>, prev: T): T {
  if (typeof updater === "function") {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function buildEnabledUsers(users: PushUser[]): PushUser[] {
  return users.filter((user) => user.enabled);
}

function buildUserMap(users: PushUser[]): Map<string, PushUser> {
  return new Map(users.map((user) => [user.id, user]));
}

export const createMessagesSlice: AdminSliceCreator<AdminMessagesSlice> = (set, get) => ({
  users: [],
  tasks: [],
  enabledUsers: [],
  userMap: new Map<string, PushUser>(),
  editingUserId: "",
  savingUser: false,
  userForm: EMPTY_USER_FORM,
  editingTaskId: "",
  savingTask: false,
  runningTaskId: "",
  taskForm: EMPTY_TASK_FORM,
  setUserForm: (value) => {
    set((state) => ({
      userForm: resolveUpdater<UserFormState>(value, state.userForm)
    }));
  },
  setTaskForm: (value) => {
    set((state) => ({
      taskForm: resolveUpdater<TaskFormState>(value, state.taskForm)
    }));
  },
  loadUsers: async () => {
    const payload = await request<{ users: PushUser[] }>("/admin/api/users");
    const users = Array.isArray(payload.users) ? payload.users : [];
    set({
      users,
      enabledUsers: buildEnabledUsers(users),
      userMap: buildUserMap(users)
    });
    get().syncMarketTaskUserSelection();
  },
  loadTasks: async () => {
    const payload = await request<{ tasks: ScheduledTask[] }>("/admin/api/tasks");
    set({ tasks: Array.isArray(payload.tasks) ? payload.tasks : [] });
  },
  beginCreateUser: () => {
    set({
      editingUserId: "",
      userForm: EMPTY_USER_FORM
    });
  },
  beginEditUser: (user) => {
    set({
      editingUserId: user.id,
      userForm: {
        name: user.name,
        wecomUserId: user.wecomUserId,
        enabled: user.enabled
      }
    });
  },
  handleSubmitUser: async (event) => {
    event.preventDefault();

    const editingUserId = get().editingUserId;
    const userForm = get().userForm;
    const payload: UserFormState = {
      name: userForm.name.trim(),
      wecomUserId: userForm.wecomUserId.trim(),
      enabled: userForm.enabled
    };

    if (!payload.name || !payload.wecomUserId) {
      get().setNotice({ type: "error", title: "请填写完整用户信息" });
      return;
    }

    set({ savingUser: true });
    try {
      if (editingUserId) {
        await request(`/admin/api/users/${encodeURIComponent(editingUserId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        get().setNotice({ type: "success", title: "推送用户已更新" });
      } else {
        await request("/admin/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        get().setNotice({ type: "success", title: "推送用户已创建" });
      }

      await Promise.all([get().loadUsers(), get().loadTasks()]);
      get().beginCreateUser();
    } catch (error) {
      get().setNotice({ type: "error", title: "保存推送用户失败", text: toErrorText(error) });
    } finally {
      set({ savingUser: false });
    }
  },
  handleDeleteUser: async (user) => {
    try {
      await request(`/admin/api/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await Promise.all([get().loadUsers(), get().loadTasks()]);
      if (get().editingUserId === user.id) {
        get().beginCreateUser();
      }
      get().setNotice({ type: "success", title: "推送用户已删除" });
    } catch (error) {
      get().setNotice({ type: "error", title: "删除推送用户失败", text: toErrorText(error) });
    }
  },
  beginCreateTask: () => {
    set({
      editingTaskId: "",
      taskForm: EMPTY_TASK_FORM
    });
  },
  beginEditTask: (task) => {
    set({
      editingTaskId: task.id,
      taskForm: {
        name: task.name,
        time: task.time,
        userIds: [...task.userIds],
        message: task.message,
        enabled: task.enabled
      }
    });
  },
  handleSubmitTask: async (event) => {
    event.preventDefault();

    const editingTaskId = get().editingTaskId;
    const taskForm = get().taskForm;
    const payload: TaskFormState = {
      name: taskForm.name.trim(),
      time: taskForm.time.trim(),
      userIds: taskForm.userIds,
      message: taskForm.message.trim(),
      enabled: taskForm.enabled
    };

    if (!payload.name || !payload.time || payload.userIds.length === 0 || !payload.message) {
      get().setNotice({ type: "error", title: "请填写完整任务信息" });
      return;
    }

    set({ savingTask: true });
    try {
      if (editingTaskId) {
        await request(`/admin/api/tasks/${encodeURIComponent(editingTaskId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        get().setNotice({ type: "success", title: "定时任务已更新" });
      } else {
        await request("/admin/api/tasks", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        get().setNotice({ type: "success", title: "定时任务已创建" });
      }

      await get().loadTasks();
      get().beginCreateTask();
    } catch (error) {
      get().setNotice({ type: "error", title: "保存定时任务失败", text: toErrorText(error) });
    } finally {
      set({ savingTask: false });
    }
  },
  handleDeleteTask: async (task) => {
    try {
      await request(`/admin/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await get().loadTasks();
      if (get().editingTaskId === task.id) {
        get().beginCreateTask();
      }
      get().setNotice({ type: "success", title: "定时任务已删除" });
    } catch (error) {
      get().setNotice({ type: "error", title: "删除定时任务失败", text: toErrorText(error) });
    }
  },
  handleRunTask: async (task) => {
    set({ runningTaskId: task.id });
    try {
      const payload = await request<{ acceptedAsync: boolean; responseText?: string }>(
        `/admin/api/tasks/${encodeURIComponent(task.id)}/run`,
        {
          method: "POST",
          body: "{}"
        }
      );
      await get().loadTasks();
      if (payload.acceptedAsync) {
        get().setNotice({ type: "info", title: "任务已异步受理，稍后将回调用户" });
      } else {
        get().setNotice({ type: "success", title: "任务已执行并推送", text: payload.responseText });
      }
    } catch (error) {
      get().setNotice({ type: "error", title: "手动触发任务失败", text: toErrorText(error) });
    } finally {
      set({ runningTaskId: "" });
    }
  }
});
