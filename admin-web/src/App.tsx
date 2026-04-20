import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CelestiaSection } from "@/components/admin/CelestiaSection";
import { ConversationBenchmarkSection } from "@/components/admin/ConversationBenchmarkSection";
import { DirectInputMappingSection } from "@/components/admin/DirectInputMappingSection";
import { EvolutionSection } from "@/components/admin/EvolutionSection";
import { FeatureMenu } from "@/components/admin/FeatureMenu";
import { MarketSection } from "@/components/admin/MarketSection";
import { MessagesSection } from "@/components/admin/MessagesSection";
import { SystemSection } from "@/components/admin/SystemSection";
import { TopicSummarySection } from "@/components/admin/TopicSummarySection";
import { WeComMenuSection } from "@/components/admin/WeComMenuSection";
import { WritingOrganizerSection } from "@/components/admin/WritingOrganizerSection";
import { useAdminBootstrap } from "@/components/admin/hooks/useAdminBootstrap";
import { useAdminStore } from "@/components/admin/hooks/useAdminStore";

export default function App() {
  useAdminBootstrap();

  const activeMenu = useAdminStore((state) => state.activeMenu);
  const setActiveMenu = useAdminStore((state) => state.setActiveMenu);
  const notice = useAdminStore((state) => state.notice);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Paimon Admin</h1>
        <p className="text-sm text-muted-foreground">在一个页面中管理模型、消息任务、Market/Topic/Writing 模块与 Evolution 引擎</p>
      </header>

      {notice ? (
        <Alert variant={notice.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{notice.title}</AlertTitle>
          {notice.text ? <AlertDescription>{notice.text}</AlertDescription> : null}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <FeatureMenu activeMenu={activeMenu} onChange={setActiveMenu} />

        <section className="min-w-0 space-y-4">
          {activeMenu === "system" ? <SystemSection /> : null}
          {activeMenu === "conversation" ? <ConversationBenchmarkSection /> : null}
          {activeMenu === "evolution" ? <EvolutionSection /> : null}
          {activeMenu === "market" ? <MarketSection /> : null}
          {activeMenu === "topic" ? <TopicSummarySection /> : null}
          {activeMenu === "writing" ? <WritingOrganizerSection /> : null}
          {activeMenu === "messages" ? <MessagesSection /> : null}
          {activeMenu === "direct_input" ? <DirectInputMappingSection /> : null}
          {activeMenu === "wecom" ? <WeComMenuSection /> : null}
          {activeMenu === "celestia" ? <CelestiaSection /> : null}
        </section>
      </div>
    </main>
  );
}
