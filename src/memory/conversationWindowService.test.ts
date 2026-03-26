import assert from "node:assert/strict";
import test from "node:test";
import { ConversationWindowService } from "./conversationWindowService";

function createSessionId(): string {
  return `conversation-window:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
}

test("ConversationWindowService continues the active window within timeout", () => {
  const service = new ConversationWindowService({ timeoutSeconds: 180, maxTurns: 6 });
  const sessionId = createSessionId();

  try {
    const first = service.completeTurn({
      sessionId,
      userText: "第一轮用户消息",
      assistantText: "第一轮回复",
      userAt: "2026-03-26T10:00:00.000Z",
      assistantAt: "2026-03-26T10:00:05.000Z",
      activeSkill: {
        skillName: "market-analysis",
        objective: "继续完成盘前分析",
        followupMode: "awaiting_user"
      }
    });

    const active = service.readActive(sessionId, "2026-03-26T10:02:30.000Z");
    assert.ok(active);
    assert.equal(active.windowId, first.windowId);
    assert.equal(active.messages.length, 2);
    assert.deepEqual(active.messages.map((item) => item.role), ["user", "assistant"]);
    assert.equal(active.activeSkill?.skillName, "market-analysis");

    const second = service.completeTurn({
      sessionId,
      userText: "第二轮追问",
      assistantText: "第二轮回复",
      userAt: "2026-03-26T10:02:40.000Z",
      assistantAt: "2026-03-26T10:02:45.000Z",
      activeSkill: {
        skillName: "market-analysis",
        objective: "继续完成盘前分析",
        followupMode: "continue_same_skill"
      }
    });

    assert.equal(second.windowId, first.windowId);
    assert.equal(second.messages.length, 4);
    assert.deepEqual(second.messages.map((item) => item.content), [
      "第一轮用户消息",
      "第一轮回复",
      "第二轮追问",
      "第二轮回复"
    ]);
    assert.equal(second.activeSkill?.followupMode, "continue_same_skill");
  } finally {
    service.clear(sessionId);
  }
});

test("ConversationWindowService starts a new window after timeout", () => {
  const service = new ConversationWindowService({ timeoutSeconds: 180, maxTurns: 6 });
  const sessionId = createSessionId();

  try {
    const first = service.completeTurn({
      sessionId,
      userText: "旧窗口消息",
      assistantText: "旧窗口回复",
      userAt: "2026-03-26T10:00:00.000Z",
      assistantAt: "2026-03-26T10:00:05.000Z"
    });

    assert.equal(service.readActive(sessionId, "2026-03-26T10:03:06.000Z"), null);

    const second = service.completeTurn({
      sessionId,
      userText: "新窗口消息",
      assistantText: "新窗口回复",
      userAt: "2026-03-26T10:03:07.000Z",
      assistantAt: "2026-03-26T10:03:10.000Z"
    });

    assert.notEqual(second.windowId, first.windowId);
    assert.deepEqual(second.messages.map((item) => item.content), ["新窗口消息", "新窗口回复"]);
    assert.equal(second.activeSkill, undefined);
  } finally {
    service.clear(sessionId);
  }
});

test("ConversationWindowService trims old turns beyond maxTurns", () => {
  const service = new ConversationWindowService({ timeoutSeconds: 180, maxTurns: 2 });
  const sessionId = createSessionId();

  try {
    service.completeTurn({
      sessionId,
      userText: "turn-1-user",
      assistantText: "turn-1-assistant",
      userAt: "2026-03-26T10:00:00.000Z",
      assistantAt: "2026-03-26T10:00:02.000Z"
    });
    service.completeTurn({
      sessionId,
      userText: "turn-2-user",
      assistantText: "turn-2-assistant",
      userAt: "2026-03-26T10:01:00.000Z",
      assistantAt: "2026-03-26T10:01:02.000Z"
    });
    const snapshot = service.completeTurn({
      sessionId,
      userText: "turn-3-user",
      assistantText: "turn-3-assistant",
      userAt: "2026-03-26T10:02:00.000Z",
      assistantAt: "2026-03-26T10:02:02.000Z"
    });

    assert.equal(snapshot.messages.length, 4);
    assert.deepEqual(snapshot.messages.map((item) => item.content), [
      "turn-2-user",
      "turn-2-assistant",
      "turn-3-user",
      "turn-3-assistant"
    ]);
  } finally {
    service.clear(sessionId);
  }
});
