import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { MenuKey } from "@/types/admin";

type FeatureMenuProps = {
  activeMenu: MenuKey;
  onChange: (menu: MenuKey) => void;
};

export function FeatureMenu(props: FeatureMenuProps) {
  const items: Array<{ key: MenuKey; label: string }> = [
    { key: "system", label: "系统设置" },
    { key: "conversation", label: "对话 Benchmark" },
    { key: "messages", label: "消息任务" },
    { key: "direct_input", label: "输入映射" },
    { key: "wecom", label: "企业微信菜单" },
    { key: "celestia", label: "Celestia" },
    { key: "market", label: "Market Analysis" },
    { key: "topic", label: "Topic Summary" },
    { key: "writing", label: "Writing Organizer" },
    { key: "evolution", label: "Evolution Engine" }
  ];

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle>功能菜单</CardTitle>
        <CardDescription>侧边导航，右侧展示当前功能模块</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {items.map((item) => (
            <Button
              key={item.key}
              type="button"
              variant={props.activeMenu === item.key ? "default" : "outline"}
              className="shrink-0 justify-start lg:w-full"
              onClick={() => props.onChange(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
