import { useMemo, useState } from "react";
import type {
  Notice,
  PushUser,
  ScheduledTask,
  TaskFormState,
  UserFormState
} from "@/types/admin";
import { request } from "./adminApi";

type NoticeSetter = (notice: Notice) => void;

type UseMessagesAdminStateArgs = {
  setNotice: NoticeSetter;
};

export function useMessagesAdminState(args: UseMessagesAdminStateArgs) {
  const [users, setUsers] = useState<PushUser[]>([]);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [editingUserId, setEditingUserId] = useState("");
  const [savingUser, setSavingUser] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>({
    name: "",
    wecomUserId: "",
    enabled: true
  });
  const [editingTaskId, setEditingTaskId] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState("");
  const [taskForm, setTaskForm] = useState<TaskFormState>({
    name: "",
    time: "",
    userIds: [],
    message: "",
    enabled: true
  });

  const enabledUsers = useMemo(() => users.filter((user) => user.enabled), [users]);
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  async function loadUsers(): Promise<void> {
    const payload = await request<{ users: PushUser[] }>("/admin/api/users");
    setUsers(Array.isArray(payload.users) ? payload.users : []);
  }

  async function loadTasks(): Promise<void> {
    const payload = await request<{ tasks: ScheduledTask[] }>("/admin/api/tasks");
    setTasks(Array.isArray(payload.tasks) ? payload.tasks : []);
  }

  function beginCreateUser(): void {
    setEditingUserId("");
    setUserForm({
      name: "",
      wecomUserId: "",
      enabled: true
    });
  }

  function beginEditUser(user: PushUser): void {
    setEditingUserId(user.id);
    setUserForm({
      name: user.name,
      wecomUserId: user.wecomUserId,
      enabled: user.enabled
    });
  }

  async function handleSubmitUser(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const payload: UserFormState = {
      name: userForm.name.trim(),
      wecomUserId: userForm.wecomUserId.trim(),
      enabled: userForm.enabled
    };

    if (!payload.name || !payload.wecomUserId) {
      args.setNotice({ type: "error", title: "请填写完整用户信息" });
      return;
    }

    setSavingUser(true);
    try {
      if (editingUserId) {
        await request(`/admin/api/users/${encodeURIComponent(editingUserId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        args.setNotice({ type: "success", title: "推送用户已更新" });
      } else {
        await request("/admin/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        args.setNotice({ type: "success", title: "推送用户已创建" });
      }

      await Promise.all([loadUsers(), loadTasks()]);
      beginCreateUser();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "保存推送用户失败", text });
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDeleteUser(user: PushUser): Promise<void> {
    try {
      await request(`/admin/api/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await Promise.all([loadUsers(), loadTasks()]);
      if (editingUserId === user.id) {
        beginCreateUser();
      }
      args.setNotice({ type: "success", title: "推送用户已删除" });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "删除推送用户失败", text });
    }
  }

  function beginCreateTask(): void {
    setEditingTaskId("");
    setTaskForm({
      name: "",
      time: "",
      userIds: [],
      message: "",
      enabled: true
    });
  }

  function beginEditTask(task: ScheduledTask): void {
    setEditingTaskId(task.id);
    setTaskForm({
      name: task.name,
      time: task.time,
      userIds: [...task.userIds],
      message: task.message,
      enabled: task.enabled
    });
  }

  async function handleSubmitTask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const payload: TaskFormState = {
      name: taskForm.name.trim(),
      time: taskForm.time.trim(),
      userIds: taskForm.userIds,
      message: taskForm.message.trim(),
      enabled: taskForm.enabled
    };

    if (!payload.name || !payload.time || payload.userIds.length === 0 || !payload.message) {
      args.setNotice({ type: "error", title: "请填写完整任务信息" });
      return;
    }

    setSavingTask(true);
    try {
      if (editingTaskId) {
        await request(`/admin/api/tasks/${encodeURIComponent(editingTaskId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        args.setNotice({ type: "success", title: "定时任务已更新" });
      } else {
        await request("/admin/api/tasks", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        args.setNotice({ type: "success", title: "定时任务已创建" });
      }

      await loadTasks();
      beginCreateTask();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "保存定时任务失败", text });
    } finally {
      setSavingTask(false);
    }
  }

  async function handleDeleteTask(task: ScheduledTask): Promise<void> {
    try {
      await request(`/admin/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
        body: "{}"
      });
      await loadTasks();
      if (editingTaskId === task.id) {
        beginCreateTask();
      }
      args.setNotice({ type: "success", title: "定时任务已删除" });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "删除定时任务失败", text });
    }
  }

  async function handleRunTask(task: ScheduledTask): Promise<void> {
    setRunningTaskId(task.id);
    try {
      const payload = await request<{ acceptedAsync: boolean; responseText?: string }>(
        `/admin/api/tasks/${encodeURIComponent(task.id)}/run`,
        {
          method: "POST",
          body: "{}"
        }
      );
      await loadTasks();
      if (payload.acceptedAsync) {
        args.setNotice({ type: "info", title: "任务已异步受理，稍后将回调用户" });
      } else {
        args.setNotice({ type: "success", title: "任务已执行并推送", text: payload.responseText });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "unknown error");
      args.setNotice({ type: "error", title: "手动触发任务失败", text });
    } finally {
      setRunningTaskId("");
    }
  }

  return {
    users,
    tasks,
    enabledUsers,
    userMap,
    editingUserId,
    savingUser,
    userForm,
    editingTaskId,
    savingTask,
    runningTaskId,
    taskForm,
    setUserForm,
    setTaskForm,
    loadUsers,
    loadTasks,
    beginCreateUser,
    beginEditUser,
    handleSubmitUser,
    handleDeleteUser,
    beginCreateTask,
    beginEditTask,
    handleSubmitTask,
    handleDeleteTask,
    handleRunTask
  };
}
