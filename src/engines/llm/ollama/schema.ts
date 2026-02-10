export function buildActionSchema(): string {
  const schema = {
    actions: [
      {
        type: "tool.call",
        params: {
          tool: "string",
          op: "string",
          args: "object",
          on_success: "action?",
          on_failure: "action?"
        }
      },
      {
        type: "skill.call",
        params: {
          name: "string",
          input: "string"
        }
      },
      {
        type: "llm.call",
        params: {
          promptText: "string?",
          context: "object?",
          image: "object?"
        }
      },
      {
        type: "respond",
        params: {
          text: "string"
        }
      }
    ]
  };

  return JSON.stringify(schema, null, 2);
}
