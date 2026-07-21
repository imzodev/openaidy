export interface Chapter {
  tag: string;
  title: string;
  description: string;
}

export const CHAPTERS: Chapter[] = [
  {
    tag: 'Agents',
    title: 'Configure your agents',
    description:
      'Define personality, system prompts, and the tools each agent can reach. One agent for code review, another for ops, another for research — each tuned for its job.',
  },
  {
    tag: 'Channels',
    title: 'Connect every channel',
    description:
      'Bring agents into Slack, Discord, Telegram, and WhatsApp. Same agent, every surface — no rebuilding per channel.',
  },
  {
    tag: 'Skills & MCP',
    title: 'Extend with skills & MCP',
    description:
      'Pull reusable skill modules from the registry or author your own. Wire up any MCP-compatible tool or data source — no custom glue code.',
  },
  {
    tag: 'Tasks',
    title: 'Track work, ship faster',
    description:
      'Tasks flow through a kanban pipeline. Sessions preserve context across every conversation — pick up where you left off.',
  },
];

export const CHAT_PANEL_HEADERS = [
  'Agents',
  'Channels',
  'Skills & MCP',
  'Tasks',
] as const;

export const WORKSPACE_PANEL_HEADERS = [
  'Agent Registry',
  'Channels',
  'Skills Registry',
  'Task Pipeline',
] as const;

export const WORKSPACE_TABS = [
  'Agents',
  'Channels',
  'Skills',
  'Tasks',
] as const;

export interface ChatMessage {
  avatar: string;
  meta: string;
  text: string;
}

export interface ChatChapter {
  user: ChatMessage;
  agent: ChatMessage;
  check: string;
  live: string;
  input: string;
}

export const CHAT_CHAPTERS: ChatChapter[] = [
  {
    user: {
      avatar: 'L',
      meta: '@lina · 9:02 AM',
      text: "Need an agent that only knows about billing — shouldn't touch deploy or DB schema.",
    },
    agent: {
      avatar: 'A',
      meta: 'admin · 9:02 AM',
      text: 'Created billing-bot — scoped tools, isolated skills, no MCP.',
    },
    check: 'Agent registered, scope verified',
    live: 'Assigning billing-bot to #billing',
    input: 'Send to admin…',
  },
  {
    user: {
      avatar: 'K',
      meta: '@kira · 11:30 AM',
      text: '/connect telegram @openaidy_bot',
    },
    agent: {
      avatar: 'O',
      meta: 'openaidy · 11:30 AM',
      text: 'Connecting Telegram… exchange complete. Bot authorized for DMs and group mentions.',
    },
    check: '3 channels active · 0 errors',
    live: 'Syncing conversation history with first session',
    input: 'Send to openaidy…',
  },
  {
    user: {
      avatar: 'D',
      meta: '@dario · 4:18 PM',
      text: 'Support needs to query our internal docs. Can the kb MCP be wired in?',
    },
    agent: {
      avatar: 'S',
      meta: 'support · 4:18 PM',
      text: 'Added kb-mcp server and loaded the faq skill. Ready to answer.',
    },
    check: 'MCP connected · 42 docs indexed',
    live: 'Running skill: faq',
    input: 'Send to support…',
  },
  {
    user: {
      avatar: 'M',
      meta: '@marco · 2:14 PM',
      text: 'Same auth bug from yesterday — push it back to the coder agent and keep the session.',
    },
    agent: {
      avatar: 'C',
      meta: 'coder · 2:14 PM',
      text: 'Resuming session #auth-fix-42. I remember the rate-limit context from earlier.',
    },
    check: 'Task moved In progress · context loaded',
    live: 'Streaming step-by-step output',
    input: 'Send to coder…',
  },
];
