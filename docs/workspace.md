---
summary: 'Per-agent workspace files and permissions'
read_when:
  - You want an agent to read/write files on disk, scoped to its own workspace
title: 'Workspace'
---

# Workspace

Each agent can be given a **workspace** — a directory on disk it can read from and write to, using the `workspace_read`, `workspace_write`, `workspace_list`, and `workspace_delete` tools.

## Configuring a workspace

Set on an agent's profile (Settings → Agents):

- **Path** — the directory this agent's workspace points at
- **Permissions** — independently toggle `read`, `write`, `delete`, and `list`
- **Include / exclude** — optional glob patterns to further scope which files inside the path the agent can touch

By default a workspace is read/list-enabled but not write/delete-enabled — an agent needs write and delete explicitly turned on before it can modify or remove files.

## Why scope it per agent

Different agents can point at different workspaces (or none at all) — a research agent might get read-only access to a docs folder, while a coding agent gets full read/write on a project directory. There's no global filesystem access; every file operation an agent performs is checked against its own workspace configuration.

## Related

- [Addons](./addons/README.md) — with the `workspace.write` permission, an addon can write a file into an agent's workspace (the agent reads it back with its own tools); for data the addon owns itself, use its private [storage](./addons/addon-permissions.md#storage-per-addon-sqlite) instead
