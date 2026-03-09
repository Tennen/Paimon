import assert from "node:assert/strict";
import test from "node:test";
import { MultiAgentService } from "../../../integrations/multiagent/service";
import { ReAgentModuleContext } from "../types";
import {
  MULTI_AGENT_COLLABORATE_ACTION,
  MULTI_AGENT_MODULE_NAME,
  MULTI_AGENT_REACT_TOOL_TABLE,
  createMultiAgentModule
} from "./multiAgentModule";

function createContext(overrides: Partial<ReAgentModuleContext> = {}): ReAgentModuleContext {
  return { sessionId: "session-1", input: "", step: 1, maxSteps: 6, history: [], ...overrides };
}

test("multiAgentModule exposes ReAct tool table metadata", () => {
  assert.equal(MULTI_AGENT_REACT_TOOL_TABLE.length, 1);
  assert.equal(MULTI_AGENT_REACT_TOOL_TABLE[0].tool, MULTI_AGENT_MODULE_NAME);
  assert.equal(MULTI_AGENT_REACT_TOOL_TABLE[0].action, MULTI_AGENT_COLLABORATE_ACTION);
});

test("multiAgentModule forwards goal/context/sessionId to multiagent service", async () => {
  let receivedGoal = "";
  let receivedContext = "";
  let receivedSessionId = "";

  const module = createMultiAgentModule(
    new MultiAgentService({
      planner: async (input) => {
        receivedGoal = input.goal;
        receivedContext = input.context ?? "";
        receivedSessionId = input.sessionId ?? "";
        return `1) 拆解目标: ${input.goal}\n2) 执行`;
      },
      critic: async () => ({ verdict: "approved", content: "计划可执行" })
    })
  );

  const result = await module.execute(
    MULTI_AGENT_COLLABORATE_ACTION,
    { goal: "发布版本", context: "含回滚方案" },
    createContext({ sessionId: "re-s-2" })
  );

  assert.equal(receivedGoal, "发布版本");
  assert.equal(receivedContext, "含回滚方案");
  assert.equal(receivedSessionId, "re-s-2");
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("expected success");
  const output = result.output as {
    planner: { role: string };
    critic: { role: string; verdict: string };
  };
  assert.equal(output.planner.role, "planner");
  assert.equal(output.critic.role, "critic");
  assert.equal(output.critic.verdict, "approved");
});

test("multiAgentModule validates action and missing goal", async () => {
  const module = createMultiAgentModule();

  const unsupported = await module.execute("plan", { goal: "test" }, createContext());
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error ?? "", /Unsupported multiagent action/);

  const missingGoal = await module.execute(MULTI_AGENT_COLLABORATE_ACTION, { goal: "   " }, createContext());
  assert.equal(missingGoal.ok, false);
  assert.equal(missingGoal.error, "Missing goal");
});
