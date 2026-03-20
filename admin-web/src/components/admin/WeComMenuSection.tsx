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
  WeComMenuButton,
  WeComMenuConfig,
  WeComMenuEventRecord,
  WeComMenuLeafButton,
  WeComMenuPublishPayload
} from "@/types/admin";

type WeComMenuSectionProps = {
  config: WeComMenuConfig;
  recentEvents: WeComMenuEventRecord[];
  publishPayload: WeComMenuPublishPayload | null;
  validationErrors: string[];
  saving: boolean;
  publishing: boolean;
  onConfigChange: (config: WeComMenuConfig) => void;
  onRefresh: () => void;
  onSave: () => void;
  onPublish: () => void;
};

export function WeComMenuSection(props: WeComMenuSectionProps) {
  function updateRootButton(index: number, patch: Partial<WeComMenuButton>): void {
    const nextButtons = props.config.buttons.map((button, buttonIndex) => {
      if (buttonIndex !== index) {
        return button;
      }
      return {
        ...button,
        ...patch
      };
    });
    props.onConfigChange({
      ...props.config,
      buttons: nextButtons
    });
  }

  function updateSubButton(rootIndex: number, subIndex: number, patch: Partial<WeComMenuLeafButton>): void {
    const nextButtons = props.config.buttons.map((button, buttonIndex) => {
      if (buttonIndex !== rootIndex) {
        return button;
      }
      return {
        ...button,
        subButtons: button.subButtons.map((subButton, currentSubIndex) => {
          if (currentSubIndex !== subIndex) {
            return subButton;
          }
          return {
            ...subButton,
            ...patch
          };
        })
      };
    });
    props.onConfigChange({
      ...props.config,
      buttons: nextButtons
    });
  }

  function addRootButton(): void {
    if (props.config.buttons.length >= 3) {
      return;
    }
    props.onConfigChange({
      ...props.config,
      buttons: props.config.buttons.concat(buildMenuButton("root"))
    });
  }

  function removeRootButton(index: number): void {
    props.onConfigChange({
      ...props.config,
      buttons: props.config.buttons.filter((_, buttonIndex) => buttonIndex !== index)
    });
  }

  function addSubButton(rootIndex: number): void {
    const nextButtons = props.config.buttons.map((button, buttonIndex) => {
      if (buttonIndex !== rootIndex || button.subButtons.length >= 5) {
        return button;
      }
      return {
        ...button,
        subButtons: button.subButtons.concat(buildLeafButton(`sub-${button.id}`))
      };
    });
    props.onConfigChange({
      ...props.config,
      buttons: nextButtons
    });
  }

  function removeSubButton(rootIndex: number, subIndex: number): void {
    const nextButtons = props.config.buttons.map((button, buttonIndex) => {
      if (buttonIndex !== rootIndex) {
        return button;
      }
      return {
        ...button,
        subButtons: button.subButtons.filter((_, currentSubIndex) => currentSubIndex !== subIndex)
      };
    });
    props.onConfigChange({
      ...props.config,
      buttons: nextButtons
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>企业微信菜单</CardTitle>
          <CardDescription>
            这里只管理 click 菜单。`EventKey` 用于接收企业微信回调，触发文本可选，填写后会把内容送入现有会话处理流程。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={props.onRefresh}>
              刷新
            </Button>
            <Button type="button" variant="outline" disabled={props.config.buttons.length >= 3} onClick={addRootButton}>
              添加一级菜单
            </Button>
            <Button type="button" disabled={props.saving} onClick={props.onSave}>
              {props.saving ? "保存中..." : "保存配置"}
            </Button>
            <Button type="button" disabled={props.publishing} onClick={props.onPublish}>
              {props.publishing ? "发布中..." : "发布到企业微信"}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <MetaCard label="本地更新时间" value={formatDateTime(props.config.updatedAt)} />
            <MetaCard label="最近发布时间" value={formatDateTime(props.config.lastPublishedAt)} />
          </div>

          <Separator />

          {props.config.buttons.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              还没有菜单配置，先添加一级菜单。
            </div>
          ) : (
            <div className="space-y-4">
              {props.config.buttons.map((button, index) => {
                const isGroup = button.subButtons.length > 0;
                return (
                  <Card key={button.id}>
                    <CardHeader className="pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">一级菜单 {index + 1}</CardTitle>
                          <CardDescription>
                            {isGroup ? "当前作为分组菜单使用，父级自身不会触发 click 事件。" : "当前作为可点击菜单使用。"}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={button.subButtons.length >= 5}
                            onClick={() => addSubButton(index)}
                          >
                            添加二级菜单
                          </Button>
                          <Button type="button" size="sm" variant="destructive" onClick={() => removeRootButton(index)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                        <div className="space-y-1.5">
                          <Label htmlFor={`root-name-${button.id}`}>菜单名称</Label>
                          <Input
                            id={`root-name-${button.id}`}
                            value={button.name}
                            onChange={(event) => updateRootButton(index, { name: event.target.value })}
                            placeholder="例如：快捷操作"
                          />
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                          <Label htmlFor={`root-enabled-${button.id}`}>启用</Label>
                          <Switch
                            id={`root-enabled-${button.id}`}
                            checked={button.enabled}
                            onCheckedChange={(checked) => updateRootButton(index, { enabled: checked })}
                          />
                        </div>
                      </div>

                      {isGroup ? (
                        <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                          已配置二级菜单时，父级的 `EventKey` 和触发文本不会发布到企业微信。
                        </div>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
                          <div className="space-y-1.5">
                            <Label htmlFor={`root-key-${button.id}`}>EventKey</Label>
                            <Input
                              id={`root-key-${button.id}`}
                              className="mono"
                              value={button.key}
                              onChange={(event) => updateRootButton(index, { key: event.target.value })}
                              placeholder="例如：ha-living-room-on"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`root-dispatch-${button.id}`}>触发文本（可选）</Label>
                            <Textarea
                              id={`root-dispatch-${button.id}`}
                              value={button.dispatchText}
                              onChange={(event) => updateRootButton(index, { dispatchText: event.target.value })}
                              placeholder="例如：/market close --explain 或 打开客厅灯"
                            />
                          </div>
                        </div>
                      )}

                      {button.subButtons.length > 0 ? (
                        <div className="space-y-3">
                          <Separator />
                          {button.subButtons.map((subButton, subIndex) => (
                            <div key={subButton.id} className="rounded-lg border border-border p-3">
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium">二级菜单 {index + 1}.{subIndex + 1}</div>
                                <div className="flex items-center gap-2">
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <span>启用</span>
                                    <Switch
                                      checked={subButton.enabled}
                                      onCheckedChange={(checked) => updateSubButton(index, subIndex, { enabled: checked })}
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => removeSubButton(index, subIndex)}
                                  >
                                    删除
                                  </Button>
                                </div>
                              </div>

                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label htmlFor={`sub-name-${subButton.id}`}>菜单名称</Label>
                                  <Input
                                    id={`sub-name-${subButton.id}`}
                                    value={subButton.name}
                                    onChange={(event) => updateSubButton(index, subIndex, { name: event.target.value })}
                                    placeholder="例如：客厅开灯"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor={`sub-key-${subButton.id}`}>EventKey</Label>
                                  <Input
                                    id={`sub-key-${subButton.id}`}
                                    className="mono"
                                    value={subButton.key}
                                    onChange={(event) => updateSubButton(index, subIndex, { key: event.target.value })}
                                    placeholder="例如：ha-living-room-on"
                                  />
                                </div>
                              </div>

                              <div className="mt-3 space-y-1.5">
                                <Label htmlFor={`sub-dispatch-${subButton.id}`}>触发文本（可选）</Label>
                                <Textarea
                                  id={`sub-dispatch-${subButton.id}`}
                                  value={subButton.dispatchText}
                                  onChange={(event) => updateSubButton(index, subIndex, { dispatchText: event.target.value })}
                                  placeholder="例如：打开客厅主灯"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>发布预览</CardTitle>
          <CardDescription>这里展示会发送给企业微信 `menu/create` 的 payload。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.validationErrors.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {props.validationErrors.map((error) => (
                <div key={error}>{error}</div>
              ))}
            </div>
          ) : null}

          <Textarea
            readOnly
            value={props.publishPayload ? JSON.stringify(props.publishPayload, null, 2) : "当前配置还不能发布，请先修正上面的校验错误。"}
            className="min-h-[220px] font-mono text-xs"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近菜单事件</CardTitle>
          <CardDescription>用于确认企业微信回调已经进入服务，并看到最终匹配到的 `EventKey`。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>EventKey</TableHead>
                <TableHead>匹配菜单</TableHead>
                <TableHead>触发文本</TableHead>
                <TableHead>用户</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.recentEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    暂无菜单事件
                  </TableCell>
                </TableRow>
              ) : (
                props.recentEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(event.receivedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(event.status)}>{formatStatusText(event.status)}</Badge>
                    </TableCell>
                    <TableCell className="mono text-xs">{event.eventKey || "-"}</TableCell>
                    <TableCell>{event.matchedButtonName || "-"}</TableCell>
                    <TableCell className="max-w-[340px]">
                      <div className="line-clamp-2 text-xs text-muted-foreground">{event.dispatchText || event.error || "-"}</div>
                    </TableCell>
                    <TableCell className="mono text-xs">{event.fromUser || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MetaCard(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="mt-1 text-sm">{props.value || "-"}</div>
    </div>
  );
}

function buildMenuButton(prefix: string): WeComMenuButton {
  return {
    id: buildLocalId(prefix),
    name: "",
    key: "",
    enabled: true,
    dispatchText: "",
    subButtons: []
  };
}

function buildLeafButton(prefix: string): WeComMenuLeafButton {
  return {
    id: buildLocalId(prefix),
    name: "",
    key: "",
    enabled: true,
    dispatchText: ""
  };
}

function buildLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getStatusVariant(status: WeComMenuEventRecord["status"]): "default" | "secondary" | "destructive" {
  if (status === "failed") {
    return "destructive";
  }
  if (status === "dispatched") {
    return "default";
  }
  return "secondary";
}

function formatStatusText(status: WeComMenuEventRecord["status"]): string {
  if (status === "dispatched") {
    return "已分发";
  }
  if (status === "recorded") {
    return "已记录";
  }
  if (status === "failed") {
    return "失败";
  }
  return "忽略";
}
