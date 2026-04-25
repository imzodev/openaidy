# Addon Permissions

Addons declare the permissions they need in the `permissions` array of `addon.json`. OpenAidy validates these at install time and uses them to control what the addon can access through the SDK.

## Permission Format

```
<resource>.<action>
<resource>.<action>:<scope>
```

- **resource** — the API area the addon wants to access
- **action** — the operation it wants to perform
- **scope** — (optional) limits the permission to a specific target (e.g., a specific agent ID)

## Implemented Permissions

These permissions are fully functional today. Each one maps to a real SDK method and backend endpoint.

### Sessions

| Permission        | SDK Method             | What It Does                 |
| ----------------- | ---------------------- | ---------------------------- |
| `sessions.list`   | `listSessions()`       | List all chat sessions       |
| `sessions.read`   | `getSession(id)`       | Get a specific session by ID |
| `sessions.write`  | `createSession(title)` | Create a new chat session    |
| `sessions.delete` | —                      | Delete a session             |

### Agents

| Permission                | SDK Method                             | What It Does                           |
| ------------------------- | -------------------------------------- | -------------------------------------- |
| `agents.list`             | `listAgents()`                         | List all available agents              |
| `agents.invoke`           | `invokeAgent(agentId, input, context)` | Send a prompt to any agent             |
| `agents.invoke:<agentId>` | `invokeAgent(agentId, input, context)` | Send a prompt to a specific agent only |

When using `agents.invoke:<agentId>`, the addon can only invoke the named agent. Attempting to invoke a different agent will return a 403 error.

### Config

| Permission    | SDK Method    | What It Does               |
| ------------- | ------------- | -------------------------- |
| `config.read` | `getConfig()` | Read the app configuration |

## Planned Permissions (Not Yet Implemented)

The following resources exist in the permission schema but **have no SDK methods or backend endpoints for addons yet**. Declaring them in `addon.json` is valid (the manifest validator accepts them) but they have no effect.

| Resource    | Status  | Description                                       |
| ----------- | ------- | ------------------------------------------------- |
| `tasks`     | Planned | Task management — no addon API exists yet         |
| `runs`      | Planned | Session execution runs — no addon API exists yet  |
| `mcp`       | Planned | MCP server integrations — no addon API exists yet |
| `workspace` | Planned | Workspace settings — no addon API exists yet      |
| `logs`      | Planned | System logs — no addon API exists yet             |
| `system`    | Planned | System-level operations — no addon API exists yet |

These will be implemented in future releases as addon capabilities expand.

## Available Actions

Not every action applies to every resource. The table below shows which actions are valid for the currently implemented resources.

| Action   | sessions             | agents           | config         |
| -------- | -------------------- | ---------------- | -------------- |
| `list`   | ✅ List sessions     | ✅ List agents   | —              |
| `read`   | ✅ Get session by ID | ✅ Get agent     | ✅ Read config |
| `write`  | ✅ Create sessions   | —                | —              |
| `delete` | ✅ Delete sessions   | —                | —              |
| `invoke` | —                    | ✅ Invoke agents | —              |
| `manage` | —                    | —                | —              |

Actions marked with **—** are not implemented for that resource.

## Examples

### Read-only addon

```json
{
  "permissions": ["sessions.list", "agents.list"]
}
```

Can list sessions and agents. Cannot create, modify, or invoke anything.

### Interactive addon

```json
{
  "permissions": [
    "sessions.list",
    "sessions.write",
    "agents.list",
    "agents.invoke"
  ]
}
```

Can list sessions, create new sessions, list agents, and invoke any agent.

### Scoped agent access

```json
{
  "permissions": ["sessions.list", "agents.invoke:price-analyzer"]
}
```

Can list sessions and invoke only the `price-analyzer` agent. Cannot invoke any other agent.

### Config reader

```json
{
  "permissions": ["config.read"]
}
```

Can only read the app configuration. No access to sessions or agents.

## Escape Hatch

The SDK also exposes a raw `request(method, path, body)` method. This is subject to the same frontend proxy allowlist — only the following paths are forwarded regardless of what the addon requests:

| Method                  | Path                 | Description                |
| ----------------------- | -------------------- | -------------------------- |
| `GET`                   | `/sessions`          | List sessions              |
| `GET`, `POST`           | `/sessions/:id`      | Get session / send message |
| `GET`                   | `/agents`            | List agents                |
| `GET`                   | `/config`            | Read config                |
| `GET`, `POST`, `DELETE` | `/api/addon-proxy/*` | Scoped addon-proxy routes  |

Any request to a path not in this list is rejected with a 403 by the browser-side bridge before it reaches the server.

## Security Layers

Addon API access is restricted at four levels:

1. **Manifest validation** — permissions in `addon.json` are checked against known resources and actions at install time
2. **Frontend proxy allowlist** — the browser-side bridge only forwards requests to a fixed set of safe paths
3. **Backend addon-proxy** — `/api/addon-proxy/*` routes validate the addon's token and check its declared permissions before executing
4. **CSP headers** — addon HTML is served with strict Content-Security-Policy headers that prevent loading external scripts or sending data to third-party servers

## Complete addon.json Example

```json
{
  "id": "my-addon",
  "name": "My Addon",
  "version": "1.0.0",
  "description": "An addon that analyzes sessions using an AI agent",
  "openaidy": {
    "minVersion": "0.1.0"
  },
  "entry": "dist/index.js",
  "permissions": ["sessions.list", "sessions.write", "agents.invoke:analyzer"],
  "ui": {
    "sidebar": {
      "icon": "box",
      "label": "My Addon",
      "order": 100
    }
  },
  "agents": [],
  "config": {
    "schema": { "type": "object", "properties": {} },
    "defaults": {}
  },
  "dependencies": {}
}
```
