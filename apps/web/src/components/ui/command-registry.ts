/**
 * Command registry for the command palette.
 *
 * The palette needs a stable list of available actions + a way to inject
 * runtime callbacks (router, theme toggle, etc.). We keep the command
 * definitions as plain data and pass the runtime context separately, so the
 * registry stays testable without mounting the full app.
 *
 * The action callbacks live in a `CommandContext` provided by the host
 * (App.tsx). Commands optionally call into the runtime via the context;
 * optional fields let commands hide themselves when the runtime can't
 * service them (e.g. "Stop Agent" while nothing is streaming).
 */

import type { Component } from 'solid-js';
import {
  Layers,
  CheckSquare,
  Zap,
  Bot,
  Wrench,
  Server,
  BarChart3,
  FileText,
  Save,
  Puzzle,
  KeyRound,
  Settings as SettingsIcon,
  Plus,
  CircleStop,
  Copy,
  Code,
  Sun,
  PanelLeftClose,
  Keyboard,
  MessageSquare,
  Bot as RecentAgentIcon,
  EyeOff,
} from 'lucide-solid';
import type { ViewType } from '../Sidebar';
import type { SessionMessage } from '../../lib/api';

export type CommandCategory = 'recent' | 'navigation' | 'actions' | 'settings';

export type Command = {
  id: string;
  label: string;
  category: CommandCategory;
  /** Sub-label shown after the primary label (e.g. page name, agent id). */
  hint?: string;
  /** Lowercase keywords appended to the searchable text. */
  keywords?: string[];
  /** lucide-solid icon component. Optional — omitted for plain recent items. */
  icon?: Component<{ class?: string }>;
  /** Human-readable shortcut shown on the right (e.g. "⌘1"). */
  shortcut?: string;
  /** When true, the command is shown but unselectable. */
  disabled?: boolean;
  /** Hidden when true (e.g. "Stop Agent" while no run is streaming). */
  hidden?: boolean;
  /** Run when the user activates the command. */
  run: (ctx: CommandContext) => void;
};

/**
 * Runtime callbacks the palette needs from the app. Concrete fields live on
 * App.tsx; this type only declares the contract. Keeping the surface small
 * also makes it easy to mock in tests.
 */
export type CommandContext = {
  navigate: (view: ViewType) => void;
  navigateToAddon?: (addonId: string) => void;
  newSession: () => void;
  /**
   * Flip the active session's private/normal flag. Only meaningful while the
   * session is still empty — `canTogglePrivacy` reports whether that's
   * currently true, so the command can hide itself otherwise.
   */
  togglePrivacy: () => void;
  canTogglePrivacy: () => boolean;
  isSessionPrivate: () => boolean;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  stopAgent?: () => void;
  /** Focus the chat composer (no-op if no session is selected). */
  focusChatInput?: () => void;
  /**
   * Return the messages for the currently selected session, or `[]` if no
   * session is selected. Used by "Copy last message" / "Copy last code
   * block".
   */
  getCurrentMessages?: () => SessionMessage[];
  /**
   * Notify the user (toast-like) that an action was performed or had no
   * effect. Optional; if omitted, the command silently no-ops.
   */
  notify?: (message: string) => void;
  /** Open a specific recent session by id. */
  openRecentSession?: (sessionId: string) => void;
  /** Open a specific recent agent by id. */
  openRecentAgent?: (agentId: string) => void;
};

/** Helper to format the platform shortcut hint consistently. */
// (Reserved for future per-platform overrides; intentionally unused for now.)

// ── Static command definitions ───────────────────────────────────────────────

/**
 * Build the navigation, actions and settings commands. Each command captures
 * the runtime callbacks it needs at call time so this list can be built once
 * and reused.
 */
export function buildStaticCommands(ctx: CommandContext): Command[] {
  return [
    // Navigation
    {
      id: 'nav.sessions',
      label: 'Go to Sessions',
      hint: 'Sessions',
      icon: Layers,
      shortcut: '⌘1',
      keywords: ['list', 'history'],
      category: 'navigation',
      run: () => ctx.navigate('sessions'),
    },
    {
      id: 'nav.chat',
      label: 'Go to Chat',
      hint: 'Active conversation',
      icon: MessageSquare,
      shortcut: '⌘0',
      keywords: ['conversation', 'messages'],
      category: 'navigation',
      run: () => ctx.navigate('chat'),
    },
    {
      id: 'nav.tasks',
      label: 'Go to Tasks',
      hint: 'Tasks',
      icon: CheckSquare,
      shortcut: '⌘3',
      category: 'navigation',
      run: () => ctx.navigate('tasks'),
    },
    {
      id: 'nav.pulses',
      label: 'Go to Pulses',
      hint: 'Pulses',
      icon: Zap,
      category: 'navigation',
      run: () => ctx.navigate('pulses'),
    },
    {
      id: 'nav.agents',
      label: 'Go to Agents',
      hint: 'Agents',
      icon: Bot,
      shortcut: '⌘2',
      keywords: ['bot'],
      category: 'navigation',
      run: () => ctx.navigate('agents'),
    },
    {
      id: 'nav.skills',
      label: 'Go to Skills',
      hint: 'Skills',
      icon: Wrench,
      category: 'navigation',
      run: () => ctx.navigate('skills'),
    },
    {
      id: 'nav.mcps',
      label: 'Go to MCP Servers',
      hint: 'MCP Servers',
      icon: Server,
      keywords: ['mcp', 'server'],
      category: 'navigation',
      run: () => ctx.navigate('mcps'),
    },
    {
      id: 'nav.logs',
      label: 'Go to Logs',
      hint: 'Logs',
      icon: FileText,
      category: 'navigation',
      run: () => ctx.navigate('logs'),
    },
    {
      id: 'nav.usage',
      label: 'Go to Usage',
      hint: 'Usage',
      icon: BarChart3,
      keywords: ['tokens', 'cost', 'billing'],
      category: 'navigation',
      run: () => ctx.navigate('usage'),
    },
    {
      id: 'nav.backups',
      label: 'Go to Backups',
      hint: 'Backups',
      icon: Save,
      category: 'navigation',
      run: () => ctx.navigate('backups'),
    },
    {
      id: 'nav.addons',
      label: 'Go to Addons',
      hint: 'Addons',
      icon: Puzzle,
      category: 'navigation',
      run: () => ctx.navigate('addons'),
    },
    {
      id: 'nav.api-keys',
      label: 'Go to Access Tokens',
      hint: 'API tokens',
      icon: KeyRound,
      keywords: ['token', 'api'],
      category: 'navigation',
      run: () => ctx.navigate('api-keys'),
    },
    {
      id: 'nav.settings',
      label: 'Go to Settings',
      hint: 'Configuration',
      icon: SettingsIcon,
      shortcut: '⌘,',
      keywords: ['config', 'preferences'],
      category: 'navigation',
      run: () => ctx.navigate('settings'),
    },

    // Actions
    {
      id: 'action.new-session',
      label: 'New Session',
      hint: 'Start a fresh conversation',
      icon: Plus,
      keywords: ['create', 'start'],
      category: 'actions',
      run: () => ctx.newSession(),
    },
    {
      id: 'action.toggle-privacy',
      label: ctx.isSessionPrivate() ? 'Make Chat Normal' : 'Make Chat Private',
      hint: ctx.isSessionPrivate()
        ? 'Switch back to a normal chat'
        : 'Not saved — gone on refresh',
      icon: EyeOff,
      keywords: ['incognito', 'ephemeral', 'private', 'toggle'],
      category: 'actions',
      hidden: !ctx.canTogglePrivacy(),
      run: () => ctx.togglePrivacy(),
    },
    {
      id: 'action.send-message',
      label: 'Send Message',
      hint: 'Focus the chat input',
      icon: MessageSquare,
      keywords: ['focus', 'chat'],
      category: 'actions',
      run: () => ctx.focusChatInput?.(),
    },
    {
      id: 'action.stop-agent',
      label: 'Stop Agent',
      hint: 'Cancel the current run',
      icon: CircleStop,
      shortcut: '⌘.',
      keywords: ['cancel', 'abort'],
      category: 'actions',
      hidden: !ctx.stopAgent,
      run: () => ctx.stopAgent?.(),
    },
    {
      id: 'action.copy-last-message',
      label: 'Copy Last Message',
      hint: 'Copy the most recent message',
      icon: Copy,
      keywords: ['clipboard'],
      category: 'actions',
      run: () => copyLastMessage(ctx),
    },
    {
      id: 'action.copy-last-code',
      label: 'Copy Last Code Block',
      hint: 'Copy the most recent fenced code block',
      icon: Code,
      keywords: ['clipboard', 'snippet'],
      category: 'actions',
      run: () => copyLastCodeBlock(ctx),
    },

    // Settings
    {
      id: 'settings.toggle-theme',
      label: 'Toggle Theme',
      hint: 'Switch light/dark/auto',
      icon: Sun,
      keywords: ['dark', 'light', 'mode'],
      category: 'settings',
      run: () => ctx.toggleTheme(),
    },
    {
      id: 'settings.toggle-sidebar',
      label: 'Toggle Sidebar',
      hint: 'Collapse or expand',
      icon: PanelLeftClose,
      keywords: ['navigation', 'collapse'],
      category: 'settings',
      run: () => ctx.toggleSidebar(),
    },
    {
      id: 'settings.shortcuts',
      label: 'Keyboard Shortcuts',
      hint: 'Show the shortcut cheat sheet',
      icon: Keyboard,
      shortcut: '⌘?',
      category: 'settings',
      run: () => ctx.notify?.('Press ⌘K to open this palette. Esc to close.'),
    },
  ];
}

// Local import alias to keep the icon reference next to its usage; avoids a
// noisy line in the icon-import block above where `MessageSquare` would
// otherwise need to be added.

// ── Helpers used by action commands ──────────────────────────────────────────

function getLastMessageContent(ctx: CommandContext): string | undefined {
  const messages = ctx.getCurrentMessages?.() ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.content) return m.content;
  }
  return undefined;
}

function copyLastMessage(ctx: CommandContext): void {
  const text = getLastMessageContent(ctx);
  if (!text) {
    ctx.notify?.('Nothing to copy yet.');
    return;
  }
  void navigator.clipboard.writeText(text);
  ctx.notify?.('Last message copied to clipboard.');
}

const FENCE_RE = /```[\w-]*\n([\s\S]*?)```/g;

function copyLastCodeBlock(ctx: CommandContext): void {
  const messages = ctx.getCurrentMessages?.() ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content;
    if (!content) continue;
    FENCE_RE.lastIndex = 0;
    const matches = [...content.matchAll(FENCE_RE)];
    const last = matches[matches.length - 1];
    if (last?.[1]) {
      const code = last[1].replace(/\n$/, '');
      void navigator.clipboard.writeText(code);
      ctx.notify?.('Code block copied to clipboard.');
      return;
    }
  }
  ctx.notify?.('No code block found in the conversation yet.');
}

// ── Category ordering for the UI ─────────────────────────────────────────────

export const CATEGORY_ORDER: CommandCategory[] = [
  'recent',
  'navigation',
  'actions',
  'settings',
];

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  recent: 'Recent',
  navigation: 'Navigation',
  actions: 'Actions',
  settings: 'Settings',
};

/**
 * Convert a recent session into a command that opens it.
 */
export function recentSessionCommand(
  session: { id: string; title: string },
  ctx: CommandContext,
): Command {
  return {
    id: `recent.session.${session.id}`,
    label: session.title,
    hint: 'Session',
    icon: MessageSquare,
    category: 'recent',
    run: () => {
      // Selecting a recent session: navigate to chat and let the host
      // wire in the session id. The host's recent-tracking handler in
      // App.tsx updates the selection (and re-records the visit).
      ctx.openRecentSession?.(session.id);
    },
  };
}

/**
 * Convert a recent agent into a command that opens it.
 */
export function recentAgentCommand(
  agent: { id: string; name: string },
  ctx: CommandContext,
): Command {
  return {
    id: `recent.agent.${agent.id}`,
    label: agent.name,
    hint: 'Agent',
    icon: RecentAgentIcon,
    category: 'recent',
    run: () => ctx.openRecentAgent?.(agent.id),
  };
}
