export function buildActionSchema(): string {
  const schema = {
    constraints: {
      actions: "Only use action types listed in actions.",
      tools: "tool/op MUST exist in tools_context._tools.schema.",
      skills: "skill.call name MUST exist in skills_context keys.",
      no_invent: "Do NOT invent actions, tools, or skills.",
      llm_call_reserved: "llm.call is internal; the model should not output llm.call."
    },
    actions: [
      {
        type: "tool.call",
        params: {
          tool: "string",
          op: "string",
          args: "object",
          on_success: "action?",
          on_failure: "action?"
        },
        required_params: ["tool", "op", "args"],
        optional_params: ["on_success", "on_failure"]
      },
      {
        type: "skill.call",
        params: {
          name: "string",
          input: "string"
        },
        required_params: ["name"],
        optional_params: ["input"]
      },
      {
        type: "llm.call",
        params: {
          promptText: "string?",
          context: "object?",
          image: "object?"
        },
        required_params: [],
        optional_params: ["promptText", "context", "image"]
      },
      {
        type: "respond",
        params: {
          text: "string"
        },
        required_params: ["text"]
      }
    ]
  };

  return JSON.stringify(schema, null, 2);
}
