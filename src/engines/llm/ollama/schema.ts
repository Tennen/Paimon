export function buildToolSchema(): string {
  const schema = {
    actions: [
      {
        type: "ha.call_service",
        params: {
          domain: "string",
          service: "string",
          entity_id: "string | string[]",
          data: "object?"
        }
      },
      {
        type: "ha.get_state",
        params: {
          entity_id: "string"
        }
      },
      {
        type: "ha.camera_snapshot",
        params: {
          entity_id: "string"
        }
      },
      {
        type: "reminder.create",
        params: {
          title: "string",
          due: "string",
          list: "string"
        }
      },
      {
        type: "note.create",
        params: {
          folder: "string",
          title: "string",
          content: "string"
        }
      },
      {
        type: "confirm",
        params: {
          text: "string"
        }
      },
      {
        type: "respond",
        params: {
          text: "string"
        }
      },
      {
        type: "noop",
        params: {}
      }
    ]
  };

  return JSON.stringify(schema, null, 2);
}
