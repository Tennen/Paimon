## AI Agent API

These routes stay under `/api/ai/v1` and are optimized for semantic device lookup and invocation.

The AI catalog is intentionally minimal:

- device `name` plus `aliases`
- command `name` plus `aliases`
- user-settable `params`
- fixed/default command params only when they matter for semantic disambiguation

The AI catalog is generated from device control metadata. To invoke vendor-specific commands that are not declared as controls, use the raw `action` form on the AI command endpoint.

### List AI Devices

`GET /api/ai/v1/devices`

Optional query parameters:

- `plugin_id`
- `kind`
- `q`

Response:

```json
[
  {
    "id": "petkit:feeder:pet-parent",
    "name": "Kitchen Feeder",
    "aliases": ["Pet Feeder"],
    "commands": [
      {
        "name": "Feed Once",
        "aliases": ["feed-once", "feed_once"],
        "action": "feed_once",
        "params": [
          {
            "name": "portions",
            "type": "number",
            "default": 1,
            "min": 1,
            "step": 1
          }
        ]
      },
      {
        "name": "Power",
        "aliases": ["power"],
        "action": "set_power",
        "params": [
          {
            "name": "on",
            "type": "boolean",
            "required": true
          }
        ]
      }
    ]
  }
]
```

Notes:

- command aliases include control aliases, default labels, control IDs, and unique underlying action names when that mapping is unambiguous
- commands hidden from the admin quick-control area are still queryable here if the underlying control metadata exists
- select parameters accept either the option `value` or its `label`

### Invoke AI Command

`POST /api/ai/v1/commands`

This endpoint supports semantic resolution and raw action execution.

#### 1. Semantic target resolution

Request body:

```json
{
  "target": "Kitchen Feeder.Feed Once",
  "params": {
    "portions": 2
  }
}
```

Alternative explicit form:

```json
{
  "device_name": "Kitchen Feeder",
  "command": "Feed Once",
  "params": {
    "portions": 2
  }
}
```

Direct command-only form:

```json
{
  "command": "Feed Once",
  "params": {
    "portions": 2
  }
}
```

Room-qualified form:

```json
{
  "target": "Kitchen.Feed Once",
  "params": {
    "portions": 2
  }
}
```

Semantic resolution rules for request fields:

- `target: "device-or-room.command"` resolves by splitting on the last `.`
- `target: "command"` is treated as a direct command lookup across all devices
- if a device or command name itself contains `.`, use explicit fields instead of `target`

#### 2. Raw action execution on a resolved device

Request body:

```json
{
  "device_id": "petkit:feeder:pet-parent",
  "action": "manual_feed_dual",
  "params": {
    "amount1": 20,
    "amount2": 20
  }
}
```

This mode bypasses AI command-name resolution and forwards the provided `action` to the owning plugin after policy/audit checks.

Response:

```json
{
  "device": {
    "id": "petkit:feeder:pet-parent",
    "name": "Kitchen Feeder"
  },
  "command": {
    "name": "Feed Once",
    "action": "feed_once",
    "target": "Kitchen Feeder.Feed Once",
    "params": {
      "portions": 2
    }
  },
  "decision": {
    "allowed": true,
    "risk_level": "low"
  },
  "result": {
    "accepted": true,
    "message": "command accepted"
  }
}
```

Resolution rules:

- `device_id` resolves a single device directly
- when `action` is omitted and `device_id` is absent:
- `device_name` or the left side of `target` can match either device `name` / `aliases` or a room name
- `command` or the right side of `target` resolves against command `name` plus `aliases`
- if no device or room qualifier is supplied, Celestia searches the command across all devices
- same-name collisions are allowed; Celestia returns HTTP `409` instead of guessing

Parameter handling:

- toggle commands require `on`
- number and select commands require their declared value parameter
- action commands only accept user parameters explicitly declared in control metadata
- parameter names are matched case-insensitively after punctuation normalization
- number parameters accept numeric strings such as `"2"`
- boolean parameters accept `true` / `false`, `on` / `off`, `yes` / `no`, and `1` / `0`