import type { ToolMeta } from '../types.js';

// ── Agents ────────────────────────────────────────────────────────────────────

export const agentsListMeta: ToolMeta = {
  name: 'agents_list',
  category: 'Agents',
  description:
    'List all enabled agents available in this OpenAidy instance. ' +
    "Returns each agent's id, name, description, and model. " +
    'Use this before creating an addon that invokes an agent — never hardcode an agent ID.',
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
    'Read the full state of a session: its metadata, messages, and runs with their statuses. ' +
    'Use this to check the progress of a session after dispatching a message with sessions_send. ' +
    'Runs show the execution lifecycle: queued → running → succeeded / failed.',
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

// ── Execution ─────────────────────────────────────────────────────────────────

export const execRunMeta: ToolMeta = {
  name: 'exec_run',
  category: 'Execution',
  description:
    'Run a shell command inside the agent workspace and return its stdout, stderr, and exit code. ' +
    'Supports pipes and redirects (executed via /bin/sh -c). ' +
    'Times out after 30 seconds. The working directory is always confined to the agent workspace.',
};

// ── Skills ────────────────────────────────────────────────────────────────────

export const skillCreateMeta: ToolMeta = {
  name: 'skill_create',
  category: 'Skills',
  description:
    'Create a new skill and save it to the skills directory. ' +
    'A skill is a reusable set of instructions that can be assigned to agents. ' +
    'The skill is immediately available after creation.',
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
    'The addon appears in the sidebar immediately — no restart needed.',
};

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const subtaskCompleteMeta: ToolMeta = {
  name: 'subtask_complete',
  category: 'Tasks',
  description:
    'REQUIRED: Mark the current subtask as successfully completed. ' +
    'ALWAYS call this tool when you finish the subtask objective — this is MANDATORY, not optional. ' +
    'Example: If asked to "post a tweet about AI", after calling twitter_post you MUST call subtask_complete to finish. ' +
    'The subtask result will be recorded from your previous messages. ' +
    'Do not end your response without calling this tool when the objective is done. ' +
    'Do not call this if you encountered errors and have not resolved them.',
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
  sessionsSendMeta,
  workspaceReadMeta,
  workspaceWriteMeta,
  workspaceListMeta,
  workspaceDeleteMeta,
  execRunMeta,
  skillCreateMeta,
  webFetchMeta,
  subtaskCompleteMeta,
  addonCreateMeta,
  presentChoicesMeta,
];
