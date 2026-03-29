import { buildHelpText, formatAppendResult, formatRestoreResult, formatSetStateResult, formatSummarizeResult, formatTopicDetail, formatTopicList } from "./formatters";
import { buildSummarizedState } from "./runtime";
import { normalizeMultilineText } from "./shared";
import { WRITING_DIRECT_COMMANDS } from "./defaults";
import { parseCommand } from "./commands";
import {
  appendTopicRawContent,
  backupTopicState,
  ensureWritingOrganizerStorage,
  getTopicDetail,
  getTopicMeta,
  listTopicMeta,
  readTopicRawLines,
  readTopicState,
  restoreTopicStateFromBackup,
  updateTopicMeta,
  writeTopicState,
  writeTopicStateSection
} from "./storage";
import {
  buildStateFromArtifacts,
  collectTopicArtifacts,
  composeDocument,
  persistDocument,
  resolveDocumentMode,
  resolveNextDocumentVersion
} from "./documents";
import {
  ensureMaterialsForSummarize,
  extractInsight,
  ingestMaterial,
  persistInsight,
  persistMaterial
} from "./materials";
import {
  WritingAppendResult,
  WritingDocument,
  WritingDocumentMode,
  WritingInsight,
  WritingMaterial,
  WritingMaterialInputMode,
  WritingMaterialType,
  WritingRestoreResult,
  WritingStateSection,
  WritingSummarizeResult,
  WritingTopicArtifacts,
  WritingTopicDetail,
  WritingTopicMeta,
  WritingTopicState
} from "./types";

export const directCommands = WRITING_DIRECT_COMMANDS;

export type {
  WritingTopicMeta,
  WritingTopicState,
  WritingTopicDetail,
  WritingAppendResult,
  WritingSummarizeResult,
  WritingRestoreResult,
  WritingStateSection,
  WritingMaterial,
  WritingInsight,
  WritingDocument,
  WritingDocumentMode
} from "./types";

export async function execute(input: string): Promise<{ text: string; result?: unknown }> {
  try {
    ensureWritingOrganizerStorage();
    const command = parseCommand(input);

    switch (command.kind) {
      case "help":
        return { text: buildHelpText() };
      case "topics": {
        const topics = listWritingTopics();
        return {
          text: formatTopicList(topics),
          result: { topics }
        };
      }
      case "show": {
        const detail = showWritingTopic(command.topicId);
        return {
          text: formatTopicDetail(detail),
          result: detail
        };
      }
      case "append": {
        const result = appendWritingTopic(command.topicId, command.content, command.title);
        return {
          text: formatAppendResult(result),
          result
        };
      }
      case "summarize": {
        const result = summarizeWritingTopic(command.topicId, command.mode);
        return {
          text: formatSummarizeResult(result),
          result
        };
      }
      case "restore": {
        const result = restoreWritingTopic(command.topicId);
        return {
          text: formatRestoreResult(result),
          result
        };
      }
      case "set_state": {
        const nextState = setWritingTopicState(command.topicId, command.section, command.content);
        return {
          text: formatSetStateResult(command.topicId, command.section, nextState),
          result: {
            topicId: command.topicId,
            section: command.section,
            state: nextState
          }
        };
      }
      default:
        return { text: buildHelpText() };
    }
  } catch (error) {
    return {
      text: `Writing Organizer 执行失败: ${(error as Error).message ?? "unknown error"}`
    };
  }
}

export function listWritingTopics(): WritingTopicMeta[] {
  ensureWritingOrganizerStorage();
  return listTopicMeta();
}

export function showWritingTopic(topicId: string): WritingTopicDetail {
  ensureWritingOrganizerStorage();
  const detail = getTopicDetail(topicId);
  const artifacts = collectTopicArtifacts(detail.meta.topicId);
  return {
    ...detail,
    artifacts
  };
}

export function appendWritingTopic(topicId: string, content: string, title?: string): WritingAppendResult {
  ensureWritingOrganizerStorage();
  const appendResult = appendTopicRawContent(topicId, content, title);

  const material = ingestMaterial({
    topicId: appendResult.topicId,
    content,
    title,
    createdAt: new Date().toISOString()
  });

  persistMaterial(material);

  return {
    ...appendResult,
    materialIds: [material.id]
  };
}

export function summarizeWritingTopic(topicId: string, mode?: WritingDocumentMode): WritingSummarizeResult {
  ensureWritingOrganizerStorage();

  const rawLines = readTopicRawLines(topicId);
  if (rawLines.length === 0) {
    throw new Error("topic 没有可整理的 raw 内容，请先 append");
  }

  const metaBefore = getTopicMeta(topicId);
  const previousState = readTopicState(topicId);
  const backup = backupTopicState(topicId);
  const generatedAt = new Date().toISOString();

  const materials = ensureMaterialsForSummarize(metaBefore.topicId, rawLines, metaBefore.title, generatedAt);
  const insight = extractInsight({
    topicId: metaBefore.topicId,
    materials,
    generatedAt
  });
  persistInsight(insight);

  const selectedMode = resolveDocumentMode(mode, metaBefore.title);
  const nextVersion = resolveNextDocumentVersion(metaBefore.topicId);

  const baselineState = buildSummarizedState({
    meta: metaBefore,
    rawLines,
    previousState,
    generatedAt
  });

  const composed = composeDocument({
    topicId: metaBefore.topicId,
    title: metaBefore.title,
    mode: selectedMode,
    version: nextVersion,
    generatedAt,
    materials,
    insight,
    baselineDraft: baselineState.draft
  });
  persistDocument(composed.document, composed.markdown);

  const nextState = buildStateFromArtifacts({
    title: metaBefore.title,
    mode: selectedMode,
    generatedAt,
    insight,
    document: composed.document,
    markdown: composed.markdown
  });

  const state = writeTopicState(metaBefore.topicId, nextState);
  const meta = updateTopicMeta(metaBefore.topicId, { lastSummarizedAt: generatedAt });

  return {
    topicId: meta.topicId,
    meta,
    state,
    backup,
    rawLineCount: rawLines.length,
    generatedAt,
    materialCount: materials.length,
    mode: selectedMode,
    insight,
    document: composed.document
  };
}

export function restoreWritingTopic(topicId: string): WritingRestoreResult {
  ensureWritingOrganizerStorage();
  const state = restoreTopicStateFromBackup(topicId);
  const meta = updateTopicMeta(topicId);
  return {
    topicId: meta.topicId,
    meta,
    state
  };
}

export function setWritingTopicState(topicId: string, section: WritingStateSection, content: string): WritingTopicState {
  ensureWritingOrganizerStorage();
  const state = writeTopicStateSection(topicId, section, content);
  updateTopicMeta(topicId);
  return state;
}
