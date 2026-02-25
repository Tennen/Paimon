import { FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/adminFormat";
import {
  PushUser,
  ScheduledTask,
  TaskFormState,
  UserFormState
} from "@/types/admin";

type MessagesSectionProps = {
  users: PushUser[];
  tasks: ScheduledTask[];
  userMap: Map<string, PushUser>;
  enabledUsers: PushUser[];
  editingUserId: string;
  savingUser: boolean;
  userForm: UserFormState;
  editingTaskId: string;
  savingTask: boolean;
  runningTaskId: string;
  taskForm: TaskFormState;
  onUserFormChange: (patch: Partial<UserFormState>) => void;
  onBeginCreateUser: () => void;
  onBeginEditUser: (user: PushUser) => void;
  onSubmitUser: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteUser: (user: PushUser) => void;
  onTaskFormChange: (patch: Partial<TaskFormState>) => void;
  onBeginCreateTask: () => void;
  onBeginEditTask: (task: ScheduledTask) => void;
  onSubmitTask: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteTask: (task: ScheduledTask) => void;
  onRunTask: (task: ScheduledTask) => void;
};

export function MessagesSection(props: MessagesSectionProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
      <Card>
        <CardHeader>
          <CardTitle>推送用户</CardTitle>
          <CardDescription>先创建消息接收人，后续任务可直接选择</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={props.onSubmitUser}>
            <div className="space-y-1.5">
              <Label htmlFor="user-name">名称</Label>
              <Input
                id="user-name"
                value={props.userForm.name}
                onChange={(event) => props.onUserFormChange({ name: event.target.value })}
                placeholder="例如：天气播报对象"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-wecom-id">企业微信账号（UserId）</Label>
              <Input
                id="user-wecom-id"
                className="mono"
                value={props.userForm.wecomUserId}
                onChange={(event) => props.onUserFormChange({ wecomUserId: event.target.value })}
                placeholder="例如：zhangsan（与通讯录一致）"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor="user-enabled">启用</Label>
              <Switch
                id="user-enabled"
                checked={props.userForm.enabled}
                onCheckedChange={(checked) => props.onUserFormChange({ enabled: checked })}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={props.savingUser}>
                {props.savingUser ? "保存中..." : props.editingUserId ? "更新用户" : "创建用户"}
              </Button>
              {props.editingUserId ? (
                <Button type="button" variant="outline" onClick={props.onBeginCreateUser}>
                  取消编辑
                </Button>
              ) : null}
            </div>
          </form>

          <Separator />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>企业微信账号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-[180px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    暂无推送用户
                  </TableCell>
                </TableRow>
              ) : (
                props.users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.name}</TableCell>
                    <TableCell className="mono text-xs">{user.wecomUserId}</TableCell>
                    <TableCell>
                      <Badge variant={user.enabled ? "default" : "secondary"}>{user.enabled ? "启用" : "停用"}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => props.onBeginEditUser(user)}>
                        编辑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (window.confirm(`确认删除用户 ${user.name} ?`)) {
                            props.onDeleteUser(user);
                          }
                        }}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>定时任务（每日）</CardTitle>
          <CardDescription>设置每天自动发送的内容和时间，到点后会自动推送给所选用户</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={props.onSubmitTask}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-name">任务名称</Label>
                <Input
                  id="task-name"
                  value={props.taskForm.name}
                  onChange={(event) => props.onTaskFormChange({ name: event.target.value })}
                  placeholder="例如：天气晨报"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-time">时间（HH:mm）</Label>
                <Input
                  id="task-time"
                  type="time"
                  value={props.taskForm.time}
                  onChange={(event) => props.onTaskFormChange({ time: event.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>推送用户</Label>
              <Select
                value={props.taskForm.userId || undefined}
                onValueChange={(value) => props.onTaskFormChange({ userId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={props.enabledUsers.length > 0 ? "选择推送用户" : "请先创建并启用推送用户"} />
                </SelectTrigger>
                <SelectContent>
                  {props.users.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      暂无推送用户
                    </SelectItem>
                  ) : (
                    props.users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name} ({user.wecomUserId}){user.enabled ? "" : " [停用]"}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-message">消息内容</Label>
              <Textarea
                id="task-message"
                value={props.taskForm.message}
                onChange={(event) => props.onTaskFormChange({ message: event.target.value })}
                placeholder="例如：请播报今天上海天气，并给出穿衣建议"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor="task-enabled">启用</Label>
              <Switch
                id="task-enabled"
                checked={props.taskForm.enabled}
                onCheckedChange={(checked) => props.onTaskFormChange({ enabled: checked })}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={props.savingTask || props.enabledUsers.length === 0}>
                {props.savingTask ? "保存中..." : props.editingTaskId ? "更新任务" : "创建任务"}
              </Button>
              {props.editingTaskId ? (
                <Button type="button" variant="outline" onClick={props.onBeginCreateTask}>
                  取消编辑
                </Button>
              ) : null}
            </div>
          </form>

          <Separator />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>时间</TableHead>
                <TableHead>推送用户</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>上次运行</TableHead>
                <TableHead className="w-[210px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    暂无定时任务
                  </TableCell>
                </TableRow>
              ) : (
                props.tasks.map((task) => {
                  const user = task.userId ? props.userMap.get(task.userId) : undefined;
                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div className="font-medium">{task.name}</div>
                        <div className="line-clamp-2 text-xs text-muted-foreground">{task.message}</div>
                      </TableCell>
                      <TableCell className="mono text-xs">{task.time}</TableCell>
                      <TableCell>
                        {user ? (
                          <div>
                            <div>{user.name}</div>
                            <div className="mono text-xs text-muted-foreground">{user.wecomUserId}</div>
                          </div>
                        ) : (
                          <div className="mono text-xs text-muted-foreground">{task.toUser || "-"}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={task.enabled ? "default" : "secondary"}>{task.enabled ? "启用" : "停用"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(task.lastRunAt)}</TableCell>
                      <TableCell className="space-x-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={props.runningTaskId === task.id}
                          onClick={() => props.onRunTask(task)}
                        >
                          {props.runningTaskId === task.id ? "执行中..." : "立即执行"}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => props.onBeginEditTask(task)}>
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (window.confirm(`确认删除任务 ${task.name} ?`)) {
                              props.onDeleteTask(task);
                            }
                          }}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
