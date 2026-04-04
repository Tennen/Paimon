import { listConversationSkillOptions, listConversationToolOptions } from "../../../core/conversation/contextCatalog";
import { AdminRouteContext } from "../context";

export function buildConversationContextAdminSnapshot(context: AdminRouteContext) {
  const snapshot = context.conversationContextService.getSnapshot();
  return {
    config: snapshot.config,
    store: snapshot.store,
    availableSkills: listConversationSkillOptions(context.skillManager, context.toolRegistry),
    availableTools: listConversationToolOptions(context.toolRegistry)
  };
}

export function getAvailableConversationContextNames(context: AdminRouteContext): {
  skillNames: string[];
  toolNames: string[];
} {
  const availableSkills = listConversationSkillOptions(context.skillManager, context.toolRegistry);
  const availableTools = listConversationToolOptions(context.toolRegistry);
  return {
    skillNames: availableSkills.map((item) => item.name),
    toolNames: availableTools.map((item) => item.name)
  };
}

export function normalizeOptionalStringArray(input: unknown): string[] | null {
  if (!Array.isArray(input)) {
    return null;
  }
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}
