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

| Permission        | SDK Method                                 | What It Does                          |
| ----------------- | ------------------------------------------ | ------------------------------------- |
| `sessions.list`   | `listSessions()`                           | List all chat sessions                |
| `sessions.read`   | `getSession(id)`                           | Get a specific session by ID          |
| `sessions.write`  | `sendMessage(sessionId, content, agentId)` | Send a message to an existing session |
| `sessions.delete` | —                                          | Delete a session                      |

> **Note:** Sessions are created automatically when you call `invokeAgent()`. There is no `sessions.create` permission. Use `sessions.list` to discover sessions, then `sessions.write` to send messages to them.

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

### Storage (per-addon SQLite)

Each addon gets its own private SQLite database, schema declared in `addon.json` under `storage.migrations`.

| Permission      | SDK Method                             | What It Does                           |
| --------------- | -------------------------------------- | -------------------------------------- |
| `storage.read`  | `storage.kv.get(key)`                  | Read a key/value pair                  |
| `storage.read`  | `storage.kv.list(prefix?)`             | List key/value pairs                   |
| `storage.write` | `storage.kv.set(key, value)`           | Write a key/value pair                 |
| `storage.write` | `storage.kv.delete(key)`               | Delete a key/value pair                |
| `storage.read`  | `storage.query(sql, params?)`          | Run a read (`SELECT`) query            |
| `storage.write` | `storage.exec(sql, params?)`           | Run a write statement                  |
| `storage.read`  | `storage.search(table, match, limit?)` | Full-text search over a declared table |

### Tasks

Deliberately narrower than the web UI's task API — no agent assignment, no scheduling, no subtask CRUD.

| Permission     | SDK Method                                       | What It Does                              |
| -------------- | ------------------------------------------------ | ----------------------------------------- |
| `tasks.list`   | `tasks.list(status?)`                            | List tasks, optionally filtered by status |
| `tasks.read`   | `tasks.get(id)`                                  | Get a task with its subtasks and progress |
| `tasks.write`  | `tasks.create({title?, description, priority?})` | Create a task                             |
| `tasks.write`  | `tasks.updateStatus(id, status)`                 | Update a task's status                    |
| `tasks.read`   | `tasks.listSubtasks(id)`                         | List a task's subtasks                    |
| `tasks.invoke` | `tasks.execute(id)`                              | Start executing a task                    |

### Pulses

Scheduled prompts (one-off or recurring) that run against an agent, optionally inside an existing session. Addons can fully drive pulses — create, read, update, delete, trigger, and inspect run history.

| Permission      | SDK Method                                                      | What It Does                     |
| --------------- | --------------------------------------------------------------- | -------------------------------- |
| `pulses.list`   | `pulses.list(filters?)`                                         | List pulses                      |
| `pulses.read`   | `pulses.get(id)`                                                | Get a single pulse               |
| `pulses.write`  | `pulses.create({name, prompt, schedule, agentId?, sessionId?})` | Create a pulse                   |
| `pulses.write`  | `pulses.update(id, input)`                                      | Partially update a pulse         |
| `pulses.delete` | `pulses.delete(id)`                                             | Delete a pulse                   |
| `pulses.invoke` | `pulses.trigger(id)`                                            | Trigger a pulse to run right now |
| `pulses.read`   | `pulses.history(id, pagination?)`                               | List a pulse's run history       |

### Channels (read-only)

WhatsApp/Discord integrations. There is currently no "send a message" capability — channels only auto-reply to inbound messages via the agent they're configured with, so addon access is limited to visibility and connection lifecycle.

| Permission        | SDK Method                | What It Does                              |
| ----------------- | ------------------------- | ----------------------------------------- |
| `channels.list`   | `channels.list()`         | List configured channels and their status |
| `channels.read`   | `channels.getStatus(id)`  | Get a single channel's connection status  |
| `channels.manage` | `channels.connect(id)`    | Start connecting a channel                |
| `channels.manage` | `channels.disconnect(id)` | Disconnect a channel                      |

### Workspace

Addons can share a file into an agent's workspace on the agent's behalf. The addon never receives a filesystem path — the server validates and resolves it (the same guard the agent's own `workspace_write` tool uses).

| Permission                  | SDK Method                 | What It Does                                        |
| --------------------------- | -------------------------- | --------------------------------------------------- |
| `workspace.write`           | `shareFile(agentId, file)` | Write a file into any agent's workspace             |
| `workspace.write:<agentId>` | `shareFile(agentId, file)` | Write a file into a specific agent's workspace only |

`shareFile(agentId, { path, data })` takes a workspace-relative `path` and base64-encoded `data`, and resolves `{ agentId, path }` once written. The agent doesn't see the file automatically — it reads it back itself with its own `workspace_read`/`workspace_list` tools.

When using `workspace.write:<agentId>`, the addon can only write into the named agent's workspace. Writing to a different agent's workspace returns a 403 error.

## Planned Permissions (Not Yet Implemented)

The following resources exist in the permission schema but **have no SDK methods or backend endpoints for addons yet**. Declaring them in `addon.json` is valid (the manifest validator accepts them) but they have no effect.

| Resource | Status  | Description                                       |
| -------- | ------- | ------------------------------------------------- |
| `runs`   | Planned | Session execution runs — no addon API exists yet  |
| `mcp`    | Planned | MCP server integrations — no addon API exists yet |
| `logs`   | Planned | System logs — no addon API exists yet             |
| `system` | Planned | System-level operations — no addon API exists yet |

These will be implemented in future releases as addon capabilities expand. Memories, skills, and MCP server access are intentionally reached indirectly — through whatever agent the addon is permitted to invoke — rather than exposed as their own addon-proxy resources.

## Available Actions

Not every action applies to every resource. The table below shows which actions are valid for the currently implemented resources.

| Action   | sessions                   | agents           | config         | storage              | tasks                   | pulses               | channels              | workspace     |
| -------- | -------------------------- | ---------------- | -------------- | -------------------- | ----------------------- | -------------------- | --------------------- | ------------- |
| `list`   | ✅ List sessions           | ✅ List agents   | —              | —                    | ✅ List tasks           | ✅ List pulses       | ✅ List channels      | —             |
| `read`   | ✅ Get session by ID       | ✅ Get agent     | ✅ Read config | ✅ Read/query/search | ✅ Get task/subtasks    | ✅ Get pulse/history | ✅ Get channel status | —             |
| `write`  | ✅ Send message to session | —                | —              | ✅ Write/exec        | ✅ Create/update status | ✅ Create/update     | —                     | ✅ Write file |
| `delete` | ✅ Delete sessions         | —                | —              | —                    | —                       | ✅ Delete pulse      | —                     | —             |
| `invoke` | —                          | ✅ Invoke agents | —              | —                    | ✅ Execute task         | ✅ Trigger pulse     | —                     | —             |
| `manage` | —                          | —                | —              | —                    | —                       | —                    | ✅ Connect/disconnect | —             |

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

Can list sessions, send messages to existing sessions, list agents, and invoke any agent. Sessions are created automatically by `agents.invoke` — no extra permission needed.

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

### Pulse automation addon

```json
{
  "permissions": [
    "pulses.list",
    "pulses.read",
    "pulses.write",
    "pulses.invoke",
    "tasks.list",
    "tasks.write"
  ]
}
```

Can create and manage its own pulses (scheduled prompts), trigger them on demand, and create tasks to track the work. Cannot delete pulses or execute tasks directly.

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
  "permissions": [
    "sessions.list",
    "sessions.read",
    "sessions.write",
    "agents.invoke:analyzer"
  ],
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
