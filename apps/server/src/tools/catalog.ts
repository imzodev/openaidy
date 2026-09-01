import type { ToolMeta } from '../types.js';

// ── Agents ────────────────────────────────────────────────────────────────────

export const agentsListMeta: ToolMeta = {
  name: 'agents_list',
  category: 'Agents',
  description:
    'List all enabled agents available in this OpenAidy instance. ' +
    "Returns each agent's id, name, description, model, and the tools, " +
    'skills, and MCP servers it has access to. ' +
    'Use this before creating an addon that invokes an agent, or before ' +
    'delegating to another agent, to check what it can actually do — never hardcode an agent ID.',
};

export const agentsCreateMeta: ToolMeta = {
  name: 'agents_create',
  category: 'Agents',
  description:
    'Create a new agent and register it in this OpenAidy instance. ' +
    'The agent is immediately available for use after creation. ' +
    'Use agents_list first to verify the id does not already exist.',
};

export const agentsInvokeMeta: ToolMeta = {
  name: 'agents_invoke',
  category: 'Agents',
  description:
    '[BACKGROUND MODE] Invoke an agent and continue immediately WITHOUT waiting for the response. ' +
    "ONLY use this when you do NOT need the agent's response to complete your current task. " +
    'Examples: logging, background processing, fire-and-forget tasks, independent research. ' +
    "If you need the agent's response to continue, use agents_invoke_await instead. " +
    'Returns immediately with a sessionId. Use sessions_read later if you want to check results. ' +
    'Use agents_list to discover available agent IDs.',
};

export const agentsInvokeAwaitMeta: ToolMeta = {
  name: 'agents_invoke_await',
  category: 'Agents',
  description:
    '[AWAIT RESPONSE MODE] Invoke an agent and WAIT for the complete response before continuing. ' +
    "ALWAYS use this when you need the agent's response to complete your current task. " +
    'Examples: asking a question, requesting analysis, validation, sequential tasks, ' +
    'any case where you need to use the result in your next step. ' +
    "Returns the agent's full response after waiting up to 30 seconds. " +
    'Use agents_list to discover available agent IDs.',
};

// ── Sessions ──────────────────────────────────────────────────────────────────

export const sessionsCreateMeta: ToolMeta = {
  name: 'sessions_create',
  category: 'Sessions',
  description:
    'Create a new session. A session is a conversation container that holds messages and runs. ' +
    'Use this to create a session that you (or another agent via sessions_send) can send messages to. ' +
    'Returns the session id, title, and creation timestamp.',
};

export const sessionsListMeta: ToolMeta = {
  name: 'sessions_list',
  category: 'Sessions',
  description:
    'List all sessions. Returns each session id, title, and creation timestamp. ' +
    'Use this to discover existing sessions before reading them with sessions_read or sending messages with sessions_send.',
};

export const sessionsReadMeta: ToolMeta = {
  name: 'sessions_read',
  category: 'Sessions',
  description:
    'Read a session with full control over scope and cost. Default behavior matches legacy: ' +
    'all messages, runs included, content truncated to 500 chars. Slice cheaply with ' +
    '`limit` + `fromEnd: true` (read the last N messages), `offset` (skip first N), ' +
    '`order` (asc/desc), and `role` (filter by system/user/assistant/tool). ' +
    "Set `includeToolCalls: true` to also get each message's tool-call summary (id, name, " +
    'truncated args). Set `includeMessages: false` or `includeRuns: false` to skip a section. ' +
    'Pass `messageId` to fetch one message by id with full, untruncated content — ' +
    'useful when you already have a message id from a prior read. ' +
    'Runs show the execution lifecycle: queued → running → succeeded / failed. ' +
    'For a cheap summary (counts, last-run status, tool-call inventory) without message bodies, ' +
    'use sessions_inspect instead.',
};

export const sessionsInspectMeta: ToolMeta = {
  name: 'sessions_inspect',
  category: 'Sessions',
  description:
    'Cheap metadata view of a session — no message bodies, no run payloads. ' +
    'Returns session id/title/status, message and run counts, role counts ' +
    "(user/assistant/tool/system), the last run's status and finish reason, " +
    'and a tool-call inventory: one entry per tool that was called, with total ' +
    'call count, first/last call timestamps, and the id of the assistant ' +
    'message that most recently invoked the tool. Use this to understand what ' +
    'a session did (which tools ran, whether it succeeded, how big it is) ' +
    'without paying the cost of loading all messages. Drill into specific ' +
    'messages with sessions_read({ messageId }) once you have an id.',
};

export const sessionsSendMeta: ToolMeta = {
  name: 'sessions_send',
  category: 'Sessions',
  description:
    'Send a message to a session, optionally specifying which agent should respond. ' +
    'This dispatches asynchronously — it returns immediately. ' +
    'Use sessions_read to check progress and retrieve the response later. ' +
    'The target agent runs its own tool-call loop independently. ' +
    'To orchestrate another agent: sessions_create a new session, then sessions_send to it with that agentId.',
};

// ── Workspace ─────────────────────────────────────────────────────────────────

export const workspaceReadMeta: ToolMeta = {
  name: 'workspace_read',
  category: 'Workspace',
  description:
    'Read the contents of a file in the agent workspace. ' +
    'Returns the file content as a string.',
};

export const workspaceWriteMeta: ToolMeta = {
  name: 'workspace_write',
  category: 'Workspace',
  description:
    'Write content to a file in the agent workspace. ' +
    'Creates the file and any missing parent directories if they do not exist. ' +
    'Overwrites the file if it already exists.',
};

export const workspaceListMeta: ToolMeta = {
  name: 'workspace_list',
  category: 'Workspace',
  description:
    'List files and directories in the agent workspace. ' +
    'Returns a JSON array of entries with name, path, size, and whether each entry is a directory.',
};

export const workspaceDeleteMeta: ToolMeta = {
  name: 'workspace_delete',
  category: 'Workspace',
  description: 'Delete a file from the agent workspace.',
};

// ── Media ─────────────────────────────────────────────────────────────────────

export const mediaShareMeta: ToolMeta = {
  name: 'media_share',
  category: 'Media',
  description:
    'Share a media file (image, audio, or video) from the agent workspace in the chat, ' +
    'so the user can see or play it inline. The file must already exist in the workspace — ' +
    'create it first with workspace_write, exec_run, or another tool. ' +
    'Supported: png/jpg/jpeg/gif/webp images, wav/mp3/m4a/ogg/webm/flac/aac audio, mp4/webm/ogv video. ' +
    'Use this whenever the user would benefit from viewing a generated chart, image, ' +
    'audio clip, or video rather than reading a file path.',
};

// ── Execution ─────────────────────────────────────────────────────────────────

export const execRunMeta: ToolMeta = {
  name: 'exec_run',
  category: 'Execution',
  description:
    'Run a shell command inside the agent workspace and return its stdout, stderr, and exit code. ' +
    'On Unix, executed via /bin/sh -c; on Windows via cmd.exe /c. ' +
    'Times out after 30 seconds. The working directory is always confined to the agent workspace.',
};

// ── Code ──────────────────────────────────────────────────────────────────────
//
// Code-specific tools — separate from `workspace_*` (which is generic file
// ops). Use these when editing source code; they're optimized for token
// efficiency (line numbers, surgical edits, targeted search).

export const codeReadMeta: ToolMeta = {
  name: 'code_read',
  category: 'Code',
  description:
    'Read a source file with line numbers (cat -n style: "<n>\\t<content>"). ' +
    'Use start_line/end_line to read a slice instead of the whole file. ' +
    'Output is capped at max_lines (default 500) with a truncation notice when exceeded. ' +
    'Prefer this over workspace_read when you need to reference specific lines in a later code_edit call.',
};

export const codeEditMeta: ToolMeta = {
  name: 'code_edit',
  category: 'Code',
  description:
    'Apply one or more surgical edits to a single file in one read/write cycle. ' +
    'Pass `edits: [{old_text, new_text, global_replace?}, ...]`; edits apply in order so later ones can target text from earlier ones. ' +
    'By default each edit fails when old_text is ambiguous (matches multiple places) — the response shows 2 lines of context around each match so you can pick more surrounding text. ' +
    'Set global_replace: true on a specific edit to opt into mass-rewriting that occurrence. ' +
    'Response shows a unified-diff-style block (- old / + new) for every successful edit so you can verify the change without re-reading the file. ' +
    'Whitespace and line endings in old_text must match the file exactly.',
};

export const codeSearchMeta: ToolMeta = {
  name: 'code_search',
  category: 'Code',
  description:
    'Recursive regex search across the workspace, backed by ripgrep (rg --json). ' +
    'Output is "path:line:content" for matches and "path-line:content" for context — same shape as rg itself. ' +
    'Use include/exclude globs to scope the search (ripgrep -g syntax, e.g. "**/*.ts"). ' +
    'Returns up to max_results matches (default 100). By default excludes node_modules, .git, dist, build, .next. ' +
    'Pattern is a ripgrep / Rust regex; prefix with (?i) for case-insensitive. ' +
    'Requires ripgrep on PATH (installed by setup scripts).',
};

export const codeGlobMeta: ToolMeta = {
  name: 'code_glob',
  category: 'Code',
  description:
    'Find files via ripgrep glob matching (rg --files). Much faster than recursive readdir + JS glob matching on large trees. ' +
    'Pattern is a ripgrep glob: "*.ts", "**/*.test.ts", "src/**/index.*". ' +
    'Returns paths relative to the workspace root, one per line. ' +
    'By default excludes node_modules, .git, dist, build, .next. ' +
    'Requires ripgrep on PATH (installed by setup scripts).',
};

// ── Skills ────────────────────────────────────────────────────────────────────

export const skillCreateMeta: ToolMeta = {
  name: 'skill_create',
  category: 'Skills',
  description:
    'Create a new skill and save it to the skills directory. ' +
    'A skill is a reusable set of instructions that can be assigned to agents. ' +
    'The new skill is automatically activated for the calling agent — no ' +
    'follow-up agent_update call is needed unless the tool result says ' +
    'activation failed. ' +
    'REQUIRED parameters: id (lowercase, hyphens), name (human-readable), ' +
    'description (one-line summary used by the skill registry and by agents ' +
    'to decide when to load the skill — frontmatter is generated from these), ' +
    'and body (the actual instructions, Markdown allowed). ' +
    'Optional: version (defaults to "1.0.0") and files (companion scripts, ' +
    '.env.example, etc.). ' +
    'This is the ONLY way to create a skill — never use workspace_write, ' +
    'code_edit, or exec_run to write a SKILL.md file. Files written by those ' +
    'tools bypass the frontmatter wrap and the registry will silently skip them, ' +
    'so the skill will not load even if it is listed in the agent config. ' +
    'Pass companion files via the `files` map; SKILL.md itself comes from `body`.',
};

export const skillUpdateMeta: ToolMeta = {
  name: 'skill_update',
  category: 'Skills',
  description:
    'Modify an existing skill in your workspace. Pass only the fields you want to change — omitted fields keep their current value. ' +
    'Use files to add or overwrite companion files; pass deleteFiles to remove specific ones. ' +
    'Companion files not mentioned in either list are preserved. ' +
    'This is the ONLY way to update a skill — never use workspace_write, code_edit, or exec_run to edit SKILL.md ' +
    '(the loader will not pick up changes made outside this tool).',
};

// ── Web ───────────────────────────────────────────────────────────────────────

export const webFetchMeta: ToolMeta = {
  name: 'web_fetch',
  category: 'Web',
  description:
    'Fetch the content of a public URL and return it. ' +
    'Use format "text" (default) to get clean readable text extracted from HTML. ' +
    'Use format "raw" to get the original response body (useful for JSON APIs). ' +
    'Private/internal network addresses are blocked. Response is capped at 512 KB.',
};

// ── Addons ────────────────────────────────────────────────────────────────────

export const addonCreateMeta: ToolMeta = {
  name: 'addon_create',
  category: 'Addons',
  description:
    'Scaffold a new OpenAidy addon, register it in the database, and enable it. ' +
    'The addon appears in the sidebar immediately — no restart needed. ' +
    'This is the ONLY way to create an addon — never use workspace_write, code_edit, or exec_run to scaffold addon files (addons live in a separate directory the loader will not see otherwise).',
};

export const addonUpdateMeta: ToolMeta = {
  name: 'addon_update',
  category: 'Addons',
  description:
    'Modify an existing OpenAidy addon: overwrite/add/delete its UI files and/or ' +
    'change manifest fields (name, description, version, permissions, externalDomains). ' +
    'Keeps the on-disk addon.json and the database record in sync. ' +
    'This is the ONLY way to update an addon — never use workspace_write, code_edit, or exec_run to patch addon files (the loader will not see changes made outside this tool).',
};

export const addonReadMeta: ToolMeta = {
  name: 'addon_read',
  category: 'Addons',
  description:
    'Inspect an installed addon: its manifest (name, description, version, permissions, external domains) and the files it is built from. ' +
    'Call with just addon_id for the file inventory, then again with paths for the contents you need. ' +
    'Read before addon_update — that tool OVERWRITES whole files, so editing without reading first silently drops code. ' +
    'Addons live outside the agent workspace, so workspace_read and code_read cannot see them; this is the only way to read one.',
};

export const addonListQueriesMeta: ToolMeta = {
  name: 'addon_list_queries',
  category: 'Addons',
  description:
    'Discover the named data queries an addon exposes to agents. Returns, per addon that opted in, its addon_id and a catalog of queries (name, description, typed params, read/write). Call this before addon_run to find the right query — never guess a query name or write raw SQL.',
};

export const addonRunMeta: ToolMeta = {
  name: 'addon_run',
  category: 'Addons',
  description:
    "Run a named query an addon exposes to agents (see addon_list_queries) against that addon's private storage. " +
    'You supply the addon_id, the query name, and its declared parameters — never raw SQL. ' +
    'Read queries return rows; write queries return the number of changes (and require the addon to grant agent write access).',
};

// ── UI ────────────────────────────────────────────────────────────────────────

export const presentChoicesMeta: ToolMeta = {
  name: 'present_choices',
  category: 'UI',
  description:
    'Present the user with a list of selectable options rendered as an interactive UI card. ' +
    'Use when you want the user to pick one of several predefined answers rather than typing freely. ' +
    'Do NOT use for open-ended questions.',
};

// ── Memory ─────────────────────────────────────────────────────────────────────

export const memorySaveMeta: ToolMeta = {
  name: 'memory_save',
  category: 'Memory',
  description:
    'Store a fact, decision, or note as a named memory scoped to the calling agent. ' +
    'Use this to persist information that should be available in future conversations: ' +
    'user preferences, project context, ongoing task state, key decisions, etc.',
};

export const memorySearchMeta: ToolMeta = {
  name: 'memory_search',
  category: 'Memory',
  description:
    'Search stored memories by keyword using FTS5 full-text search (BM25 ranking). ' +
    "Returns memories ordered by relevance. The default agent can search all agents' memories; " +
    'other agents only see their own.',
};

export const memoryDeleteMeta: ToolMeta = {
  name: 'memory_delete',
  category: 'Memory',
  description:
    'Delete a memory by its ID. ' +
    'Agents can only delete their own memories. The default agent can delete any memory.',
};

export const sessionsSearchMeta: ToolMeta = {
  name: 'sessions_search',
  category: 'Memory',
  description:
    'Search past sessions by title keyword. ' +
    'Use this to find a prior conversation by topic, then call sessions_read to load the full history. ' +
    'Typical use: user says "let\'s continue the ABC project" → sessions_search("ABC project") → sessions_read.',
};

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const tasksListMeta: ToolMeta = {
  name: 'tasks_list',
  category: 'Tasks',
  description:
    'List all tasks in the Kanban board. Returns task IDs, titles, statuses, ' +
    'priorities, and planning information. Use this to find a task ID before updating it.',
};

export const tasksCreateMeta: ToolMeta = {
  name: 'tasks_create',
  category: 'Tasks',
  description:
    'Create a new task in the Kanban board. The task will be immediately visible ' +
    'to the user in their Kanban view. Returns the created task details.',
};

export const tasksUpdateMeta: ToolMeta = {
  name: 'tasks_update',
  category: 'Tasks',
  description:
    'Update an existing task in the Kanban board. Can change title, description, ' +
    'priority, status, or planning settings. Returns the updated task details.',
};

export const tasksDeleteMeta: ToolMeta = {
  name: 'tasks_delete',
  category: 'Tasks',
  description:
    'Permanently delete a task from the Kanban board. This action cannot be undone. ' +
    'Requires confirm=true to prevent accidental deletion.',
};

// ── Workflows ─────────────────────────────────────────────────────────────────
//
// A workflow is a Task with `planningEnabled: true` — i.e. a task whose
// author committed to a subtask graph instead of a flat checklist. These
// tools are the only way for an agent to operate on workflows; the generic
// `tasks_*` tools still work but they neither enforce workflow-only
// semantics nor expose workflow-specific affordances like templates.

export const workflowGetMeta: ToolMeta = {
  name: 'workflow_get',
  category: 'Workflows',
  description:
    'Read the full state of a workflow: task metadata, all subtask nodes, ' +
    'and every edge connecting them (including conditional, loop, and ' +
    'dependency edges). Returns a JSON object whose shape is round-trippable: ' +
    'workflow_create accepts the same `nodes`/`edges` arrays back, so this ' +
    'is the canonical "fetch → mutate → save" pattern. ' +
    'Pass includeNodes=false or includeEdges=false to slim the response when ' +
    'you only need one part.',
};

export const workflowCreateMeta: ToolMeta = {
  name: 'workflow_create',
  category: 'Workflows',
  description:
    'Create a new workflow (a Task with planningEnabled=true). The workflow ' +
    'is immediately visible in the Workflows page. ' +
    'REQUIRED: description (full prose of what the workflow achieves). ' +
    'Optional: title (derived from description if absent), priority, ' +
    'templateId (apply a built-in template atomically — see ' +
    'workflow_apply_template for the template id list), and ' +
    'templateInputs (a record of placeholder values for the template). ' +
    'Workflows cannot be created without planning: planningEnabled is forced ' +
    'to true regardless of what is passed. The auto-planner is suppressed ' +
    '(skipAutoPlan=true): workflows are hand-authored graphs from the agent, ' +
    'not AI-planned checklists. Build the graph yourself with ' +
    'workflow_apply_template / workflow_node_create / workflow_edge_create; ' +
    'do NOT chain this into tasks_create and expect the planner to fill it in. ' +
    'Returns the new workflow ID and a summary of created nodes/edges if a ' +
    'template was applied.',
};

export const workflowUpdateMeta: ToolMeta = {
  name: 'workflow_update',
  category: 'Workflows',
  description:
    'Update an existing workflow — change its title, description, priority, ' +
    'or status. Pass only the fields you want to change; omitted fields are ' +
    'left as-is. To edit the subtask graph (nodes/edges), use the dedicated ' +
    'node/edge tools. Rejects any task whose planningEnabled is false (use ' +
    'tasks_update for regular tasks). Returns the updated workflow summary.',
};

export const workflowDeleteMeta: ToolMeta = {
  name: 'workflow_delete',
  category: 'Workflows',
  description:
    'Permanently delete a workflow and its entire subtask graph (subtasks ' +
    'and edges cascade via foreign keys). ' +
    'This action cannot be undone. Requires confirm=true to prevent ' +
    'accidental deletion. Rejects any task whose planningEnabled is false. ' +
    'If you only want to remove a single node, use the node tools instead.',
};

export const workflowExecuteMeta: ToolMeta = {
  name: 'workflow_execute',
  category: 'Workflows',
  description:
    'Run a workflow. By default this starts the workflow from its first ' +
    'ready-to-execute nodes (the workflow entry points — nodes with no unmet ' +
    'dependencies). Pass subtaskId to execute a single node in isolation ' +
    '(useful for retries or for running one branch independently). ' +
    'Returns the session id(s) that were started; the runs are async, so ' +
    'follow up with sessions_read to track progress. ' +
    'Rejects any task whose planningEnabled is false.',
};

export const workflowApplyTemplateMeta: ToolMeta = {
  name: 'workflow_apply_template',
  category: 'Workflows',
  description:
    'Apply a built-in workflow template to an existing workflow, replacing ' +
    'its current subtask graph with the template nodes and edges. ' +
    'Available template IDs: "software-development" (a multi-stage software ' +
    'delivery workflow). Pass templateInputs to fill template placeholders ' +
    '(each template declares its own inputs; required ones must be provided). ' +
    'Pass clearExisting=true to remove all existing nodes/edges before the ' +
    'template is applied (default false: the template graph is added on top ' +
    'of whatever is there). ' +
    'Rejects any task whose planningEnabled is false. ' +
    'Returns the count of nodes and edges created.',
};

export const workflowListMeta: ToolMeta = {
  name: 'workflow_list',
  category: 'Workflows',
  description:
    'List every workflow (Task with planningEnabled=true) the agent can see, ' +
    'as a summary array: id, title, description, status, priority, and ' +
    'timestamps. Does not include nodes or edges — call workflow_get on a ' +
    'specific id to fetch the full graph. ' +
    'Filter by status (one of backlog/todo/in_progress/review/done/cancelled). ' +
    'Returns at most `limit` workflows (default 100, max 500). ' +
    'Use this to discover workflow IDs before any other workflow_* call.',
};

export const workflowNodeCreateMeta: ToolMeta = {
  name: 'workflow_node_create',
  category: 'Workflows',
  description:
    'Add a subtask (node) to an existing workflow. The workflow must have ' +
    'planningEnabled=true — non-workflow tasks are rejected. ' +
    'REQUIRED: workflowId, title, description. ' +
    'Optional: subtaskKind (default "agent"; use "approval_gate" to pause ' +
    'execution until a human resolves it), loop (bounded re-run config — ' +
    'the node keeps running until its result matches the condition or the ' +
    'iteration cap is hit), assignedAgentId (must reference an existing ' +
    'enabled agent), orderIndex (cosmetic layout hint). ' +
    'Edges are NOT created here — use workflow_edge_create after the node ' +
    'exists so the graph mutation is explicit and reviewable. ' +
    'Returns the new node ID and its initial status.',
};

export const workflowNodeUpdateMeta: ToolMeta = {
  name: 'workflow_node_update',
  category: 'Workflows',
  description:
    'Patch an existing workflow node. Pass only the fields you want to ' +
    'change — omitted fields keep their current value. ' +
    'Optional fields: title, description, subtaskKind, loop (set to null ' +
    'explicitly to clear an existing loop; omit to preserve it), orderIndex. ' +
    "If you change the node's title or description, a node that was already " +
    "'completed' or 'failed' is automatically reset to 'pending' so the next " +
    'execution picks up the new instructions — no special-casing required. ' +
    'Refuses any node whose parent task has planningEnabled=false.',
};

export const workflowNodeDeleteMeta: ToolMeta = {
  name: 'workflow_node_delete',
  category: 'Workflows',
  description:
    'Delete a single node from a workflow. Incoming and outgoing edges ' +
    'cascade away (subtask_edges has ON DELETE CASCADE), so the agent does ' +
    'not need to clean edges up first. Requires confirm=true to prevent ' +
    'accidental removal. Refuses nodes whose parent task has ' +
    'planningEnabled=false. To delete an entire workflow and its whole ' +
    'graph at once, use workflow_delete instead.',
};

export const workflowEdgeCreateMeta: ToolMeta = {
  name: 'workflow_edge_create',
  category: 'Workflows',
  description:
    'Connect two existing nodes of the same workflow with a directed ' +
    'dependency edge. `fromNodeId` is the upstream node; `toNodeId` ' +
    'cannot run until `fromNodeId` completes. ' +
    'REQUIRED: workflowId, fromNodeId, toNodeId. ' +
    'Optional edgeKind (default "dependency"; use "conditional" to gate ' +
    'on the upstream result), conditionOperator + conditionValue (required ' +
    'when edgeKind=conditional). The service rejects self-edges and ' +
    'cycles, so an edge that would deadlock the graph returns an error ' +
    'instead of being persisted.',
};

export const workflowEdgeUpdateMeta: ToolMeta = {
  name: 'workflow_edge_update',
  category: 'Workflows',
  description:
    'Patch an existing workflow edge. Pass only the fields you want to ' +
    'change — omitted fields keep their current value. ' +
    'Optional: edgeKind (switch between dependency and conditional), ' +
    'condition (pass {operator, value} to set/replace, null explicitly ' +
    'to clear, omit to preserve). ' +
    'Refuses any edge whose source subtask belongs to a non-workflow task.',
};

export const workflowEdgeDeleteMeta: ToolMeta = {
  name: 'workflow_edge_delete',
  category: 'Workflows',
  description:
    'Delete a single edge from a workflow. The two endpoint nodes are ' +
    'preserved so the agent can re-wire the graph afterwards. Requires ' +
    'confirm=true to prevent accidental severance. Refuses any edge whose ' +
    'source subtask belongs to a non-workflow task.',
};

// ── Pulses ────────────────────────────────────────────────────────────────────

export const jobsListMeta: ToolMeta = {
  name: 'pulses_list',
  category: 'Pulses',
  description:
    'List all pulses (scheduled AI tasks). Returns pulse IDs, names, schedules, statuses, ' +
    'and next run times. Use this to discover existing pulses before updating or deleting them.',
};

export const jobsCreateMeta: ToolMeta = {
  name: 'pulses_create',
  category: 'Pulses',
  description:
    'Create a new pulse (scheduled AI task). A pulse fires a prompt to an agent on a schedule. ' +
    'Supports PRESET intervals (every 15m/30m/1h/6h/12h/1d/1w) OR custom schedules via cron expression. ' +
    'IMPORTANT: For any interval NOT in the preset list (e.g., every 5 min), you MUST use schedule.cron ' +
    'with a cron expression (e.g., "*/5 * * *" for every 5 min, "*/10 * * *" for every 10 min). ' +
    'Also supports daily times and one-shot dates. ' +
    'Returns the created pulse details including ID and next run time.',
};

export const jobsUpdateMeta: ToolMeta = {
  name: 'pulses_update',
  category: 'Pulses',
  description:
    'Update an existing pulse. Can change name, prompt, schedule, or status (active/paused). ' +
    'Supports PRESET intervals (every 15m/30m/1h/6h/12h/1d/1w) OR custom schedules via cron expression. ' +
    'IMPORTANT: For any interval NOT in the preset list, use schedule.cron with a cron expression. ' +
    'Use pulses_list to find the pulse ID first. Returns the updated pulse details.',
};

export const jobsDeleteMeta: ToolMeta = {
  name: 'pulses_delete',
  category: 'Pulses',
  description:
    'Permanently delete a pulse. This action cannot be undone. ' +
    'Requires confirm=true to prevent accidental deletion.',
};

// ── Task Schedules (recurring tasks) ──────────────────────────────────────────

export const taskSchedulesListMeta: ToolMeta = {
  name: 'task_schedules_list',
  category: 'Tasks',
  description:
    "Read the schedule attached to a task. Pass taskId to get that task's " +
    'schedule. Schedules are 1:1 with tasks (a task has zero or one). ' +
    'Returns the schedule human-readable description, next/last run times, ' +
    'replan policy, and execution count.',
};

export const taskSchedulesCreateMeta: ToolMeta = {
  name: 'task_schedules_create',
  category: 'Tasks',
  description:
    'Attach a schedule to an existing task. Each task can have at most one ' +
    'schedule. Use schedule.every for PRESET intervals (every 15m/30m/1h/6h/12h/1d/1w). ' +
    'For ANY other interval (e.g. every 5min), use schedule.cron with a cron expression. ' +
    'Also supports daily times and one-shot datetimes. ' +
    'replanPolicy controls when the planning agent re-runs: ' +
    "'never' (default; cheap, reuses subtasks), " +
    "'on-description-change' (re-plans only when the description changes), " +
    "or 'always' (re-plans on every run, expensive). " +
    'maxExecutions caps the total runs (default 9999, no "infinite" option). ' +
    'Returns the created schedule with its ID and next-run time.',
};

export const taskSchedulesUpdateMeta: ToolMeta = {
  name: 'task_schedules_update',
  category: 'Tasks',
  description:
    'Update an existing task schedule. Can change the schedule definition, ' +
    'replanPolicy, maxExecutions, or status. To pause/resume use the dedicated ' +
    'task_schedules_pause and task_schedules_resume tools. To stop firing, ' +
    'use task_schedules_delete. Returns the updated schedule.',
};

export const taskSchedulesPauseMeta: ToolMeta = {
  name: 'task_schedules_pause',
  category: 'Tasks',
  description:
    'Pause a task schedule. The scheduler will skip this row until resumed. ' +
    'The schedule row, its nextRunAt, and execution history are preserved.',
};

export const taskSchedulesResumeMeta: ToolMeta = {
  name: 'task_schedules_resume',
  category: 'Tasks',
  description:
    'Resume a previously paused task schedule. The next run happens at ' +
    'the next cron tick after the resume time (we do not "catch up" missed runs).',
};

export const taskSchedulesDeleteMeta: ToolMeta = {
  name: 'task_schedules_delete',
  category: 'Tasks',
  description:
    "Permanently remove a task's schedule. The schedule row and all its " +
    'execution history are deleted. This action cannot be undone. ' +
    'Requires confirm=true to prevent accidental deletion.',
};

export const taskSchedulesTriggerMeta: ToolMeta = {
  name: 'task_schedules_trigger',
  category: 'Tasks',
  description:
    'Force an immediate run of a task schedule, without affecting nextRunAt ' +
    'or executionCount. The run is async: returns the new history row ID; ' +
    'poll task_schedules_list_executions with the same taskId to track progress.',
};

export const taskSchedulesListExecutionsMeta: ToolMeta = {
  name: 'task_schedules_list_executions',
  category: 'Tasks',
  description:
    "List execution history for a task's schedule, newest first. " +
    'Use the status filter to focus on failed runs or currently-executing runs. ' +
    'Returns for each run: id, status, startedAt, durationMs, didReplan, ' +
    'sessionId, and any error info if the run failed.',
};

// ── Master catalog ────────────────────────────────────────────────────────────
// build-system-prompt.ts reads this list to show all tools (enabled + not enabled).
// NOTE: When adding a new tool, declare its ToolMeta above and append it here.

export const ALL_TOOL_METAS: ToolMeta[] = [
  agentsListMeta,
  agentsCreateMeta,
  agentsInvokeMeta,
  agentsInvokeAwaitMeta,
  sessionsCreateMeta,
  sessionsListMeta,
  sessionsReadMeta,
  sessionsInspectMeta,
  sessionsSendMeta,
  workspaceReadMeta,
  workspaceWriteMeta,
  workspaceListMeta,
  workspaceDeleteMeta,
  codeReadMeta,
  codeEditMeta,
  codeSearchMeta,
  codeGlobMeta,
  execRunMeta,
  skillCreateMeta,
  skillUpdateMeta,
  webFetchMeta,
  addonCreateMeta,
  addonReadMeta,
  addonUpdateMeta,
  addonListQueriesMeta,
  addonRunMeta,
  presentChoicesMeta,
  memorySaveMeta,
  memorySearchMeta,
  memoryDeleteMeta,
  sessionsSearchMeta,
  tasksListMeta,
  tasksCreateMeta,
  tasksUpdateMeta,
  tasksDeleteMeta,
  jobsListMeta,
  jobsCreateMeta,
  jobsUpdateMeta,
  jobsDeleteMeta,
  taskSchedulesListMeta,
  taskSchedulesCreateMeta,
  taskSchedulesUpdateMeta,
  taskSchedulesPauseMeta,
  taskSchedulesResumeMeta,
  taskSchedulesDeleteMeta,
  taskSchedulesTriggerMeta,
  taskSchedulesListExecutionsMeta,
  workflowGetMeta,
  workflowCreateMeta,
  workflowUpdateMeta,
  workflowDeleteMeta,
  workflowExecuteMeta,
  workflowApplyTemplateMeta,
  workflowListMeta,
  workflowNodeCreateMeta,
  workflowNodeUpdateMeta,
  workflowNodeDeleteMeta,
  workflowEdgeCreateMeta,
  workflowEdgeUpdateMeta,
  workflowEdgeDeleteMeta,
];

/** Derived lookup: tool name → category string. Updated automatically from ALL_TOOL_METAS. */
export const TOOL_CATEGORY_MAP: Record<string, string> = Object.fromEntries(
  ALL_TOOL_METAS.map((m) => [m.name, m.category]),
);
