import type { FormEvent } from "react";
import type { PushUser, ScheduledTask, TaskFormState, UserFormState } from "@/types/admin";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useMessagesSectionState() {
  const state = useAdminStore(useShallow((store) => ({
    users: store.users,
    tasks: store.tasks,
    userMap: store.userMap,
    enabledUsers: store.enabledUsers,
    editingUserId: store.editingUserId,
    savingUser: store.savingUser,
    userForm: store.userForm,
    editingTaskId: store.editingTaskId,
    savingTask: store.savingTask,
    runningTaskId: store.runningTaskId,
    taskForm: store.taskForm,
    setUserForm: store.setUserForm,
    beginCreateUser: store.beginCreateUser,
    beginEditUser: store.beginEditUser,
    handleSubmitUser: store.handleSubmitUser,
    handleDeleteUser: store.handleDeleteUser,
    setTaskForm: store.setTaskForm,
    beginCreateTask: store.beginCreateTask,
    beginEditTask: store.beginEditTask,
    handleSubmitTask: store.handleSubmitTask,
    handleDeleteTask: store.handleDeleteTask,
    handleRunTask: store.handleRunTask
  })));

  return {
    users: state.users,
    tasks: state.tasks,
    userMap: state.userMap,
    enabledUsers: state.enabledUsers,
    editingUserId: state.editingUserId,
    savingUser: state.savingUser,
    userForm: state.userForm,
    editingTaskId: state.editingTaskId,
    savingTask: state.savingTask,
    runningTaskId: state.runningTaskId,
    taskForm: state.taskForm,
    onUserFormChange: (patch: Partial<UserFormState>) => {
      state.setUserForm((prev) => ({ ...prev, ...patch }));
    },
    onBeginCreateUser: state.beginCreateUser,
    onBeginEditUser: state.beginEditUser,
    onSubmitUser: (event: FormEvent<HTMLFormElement>) => {
      void state.handleSubmitUser(event);
    },
    onDeleteUser: (user: PushUser) => {
      void state.handleDeleteUser(user);
    },
    onTaskFormChange: (patch: Partial<TaskFormState>) => {
      state.setTaskForm((prev) => ({ ...prev, ...patch }));
    },
    onBeginCreateTask: state.beginCreateTask,
    onBeginEditTask: state.beginEditTask,
    onSubmitTask: (event: FormEvent<HTMLFormElement>) => {
      void state.handleSubmitTask(event);
    },
    onDeleteTask: (task: ScheduledTask) => {
      void state.handleDeleteTask(task);
    },
    onRunTask: (task: ScheduledTask) => {
      void state.handleRunTask(task);
    }
  };
}
