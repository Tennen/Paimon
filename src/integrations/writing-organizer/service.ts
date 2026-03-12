import { WRITING_DIRECT_COMMANDS } from "./defaults";
import { parseCommand } from "./commands";
import {
  buildHelpText,
  formatAppendResult,
  formatRestoreResult,
  formatSetStateResult,
  formatSummarizeResult,
  formatTopicDetail,
  formatTopicList
} from "./formatters";
import { buildSummarizedState } from "./runtime";
import {
  appendTopicRawContent,
  backupTopicState,
  ensureWritingOrganizerStorage,
  getTopicMeta,
  getTopicDetail,
  listTopicMeta,
  readTopicRawLines,
  readTopicState,
  restoreTopicStateFromBackup,
  updateTopicMeta,
  writeTopicState,
  writeTopicStateSection
} from "./storage";
import {
  WritingAppendResult,
  WritingRestoreResult,
  WritingStateSection,
  WritingSummarizeResult,
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
  WritingStateSection
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
        const result = summarizeWritingTopic(command.topicId);
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
  return getTopicDetail(topicId);
}

export function appendWritingTopic(topicId: string, content: string, title?: string): WritingAppendResult {
  ensureWritingOrganizerStorage();
  return appendTopicRawContent(topicId, content, title);
}

export function summarizeWritingTopic(topicId: string): WritingSummarizeResult {
  ensureWritingOrganizerStorage();

  const rawLines = readTopicRawLines(topicId);
  if (rawLines.length === 0) {
    throw new Error("topic 没有可整理的 raw 内容，请先 append");
  }

  const metaBefore = getTopicMeta(topicId);
  const previousState = readTopicState(topicId);
  const backup = backupTopicState(topicId);
  const generatedAt = new Date().toISOString();

  const nextState = buildSummarizedState({
    meta: metaBefore,
    rawLines,
    previousState,
    generatedAt
  });

  const state = writeTopicState(topicId, nextState);
  const meta = updateTopicMeta(topicId, { lastSummarizedAt: generatedAt });

  return {
    topicId: meta.topicId,
    meta,
    state,
    backup,
    rawLineCount: rawLines.length,
    generatedAt
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
