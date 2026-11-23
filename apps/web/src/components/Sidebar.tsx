import { Show, For, createSignal } from 'solid-js';
import {
  Plus,
  Settings,
  PanelLeft,
  MessageSquare,
  CheckSquare,
  Zap,
  Link,
  Webhook,
  Bot,
  Wrench,
  Server,
  FileText,
  Save,
  Puzzle,
  Layers,
  KeyRound,
  BarChart3,
  Brain,
  Workflow,
} from 'lucide-solid';
import { ThemeToggle } from './ThemeToggle';
import { Wordmark } from './ui/Wordmark';
import { SessionList } from './SessionList';
import type { Session, AddonRecord } from '../lib/api';
import { updateBadgeVisible } from '../stores/update-notice';
import { usePendingApprovals } from '../lib/workflow-live';
import { viewToRouteMap, RoutePaths } from '../lib/router';

// A plain left-click (no modifier keys) is handled as an in-SPA
// navigation via preventDefault; ctrl/cmd/middle/shift-click falls through
// to the browser's native anchor behavior (new tab/window) untouched.
function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export type ViewType =
  | 'chat'
  | 'sessions'
  | 'tasks'
  | 'pulses'
  | 'workflows'
  | 'workflow-detail'
  | 'channels'
  | 'webhooks'
  | 'agents'
  | 'memories'
  | 'skills'
  | 'mcps'
  | 'logs'
  | 'usage'
  | 'backups'
  | 'addons'
  | 'addon-view'
  | 'api-keys'
  | 'settings';

type SidebarProps = {
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onClearSession?: () => void;
  onToggleFavorite?: (id: string, favorited: boolean) => void | Promise<void>;
  isLoadingSessions?: boolean;
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onCollapse: () => void;
  enabledAddons?: AddonRecord[];
  activeAddonId?: string;
  onAddonSelect?: (addon: AddonRecord) => void;
};

type NavItem = {
  id: ViewType;
  label: string;
  icon: typeof MessageSquare;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: 'Work',
    items: [
      { id: 'sessions', label: 'Sessions', icon: Layers },
      { id: 'tasks', label: 'Tasks', icon: CheckSquare },
      { id: 'pulses', label: 'Pulses', icon: Zap },
      { id: 'workflows', label: 'Workflows', icon: Workflow },
    ],
  },
  {
    title: 'Connect',
    items: [
      { id: 'channels', label: 'Channels', icon: Link },
      { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    ],
  },
  {
    title: 'Build',
    items: [
      { id: 'agents', label: 'Agents', icon: Bot },
      { id: 'memories', label: 'Memories', icon: Brain },
      { id: 'skills', label: 'Skills', icon: Wrench },
      { id: 'mcps', label: 'MCP Servers', icon: Server },
    ],
  },
  {
    title: 'System',
    items: [
      { id: 'usage', label: 'Usage', icon: BarChart3 },
      { id: 'logs', label: 'Logs', icon: FileText },
      { id: 'backups', label: 'Backups', icon: Save },
      { id: 'api-keys', label: 'Access Tokens', icon: KeyRound },
    ],
  },
  {
    title: 'Addons',
    items: [{ id: 'addons', label: 'Addons', icon: Puzzle }],
  },
];

// macOS source-list rows: compact, gray-fill selection, accent-tinted icon.
function rowClass(active: boolean, collapsed: boolean): string {
  const state = active
    ? 'bg-fill-strong text-text-primary font-medium [&_svg]:text-blue-600 dark:[&_svg]:text-blue-400'
    : 'text-text-secondary hover:bg-fill hover:text-text-primary';
  const layout = collapsed ? 'justify-center px-0' : 'justify-start px-2.5';
  return `flex items-center gap-2.5 h-8 rounded-md text-[13px] transition-colors ${state} ${layout}`;
}

export function Sidebar(props: SidebarProps) {
  // Approval steps waiting on the user, shown as a badge on Workflows.
  const pendingApprovals = usePendingApprovals();
  const [isCreating, setIsCreating] = createSignal(false);

  const isMobileViewport = () =>
    typeof window !== 'undefined' && window.innerWidth < 768;

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await props.onCreateSession();
      props.onNavigate('chat');
      if (isMobileViewport()) {
        props.onCollapse();
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <Show when={!props.isCollapsed && isMobileViewport()}>
        <button
          type="button"
          aria-label="Close sidebar overlay"
          class="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] md:hidden animate-fade-in"
          onClick={props.onCollapse}
        />
      </Show>

      <aside
        class={`fixed inset-y-0 left-0 z-40 material-sidebar hairline-r flex flex-col h-full transition-all duration-300 ease-spring md:relative md:z-auto md:flex-shrink-0 ${
          props.isCollapsed
            ? '-translate-x-full w-64 max-w-[85vw] md:translate-x-0 md:w-14'
            : 'translate-x-0 w-64 max-w-[85vw]'
        }`}
      >
        {/* Header */}
        <div
          class={`flex items-center h-[52px] flex-shrink-0 ${
            props.isCollapsed
              ? 'justify-center px-0'
              : 'justify-between pl-4 pr-2.5'
          }`}
        >
          <Show when={!props.isCollapsed}>
            <Wordmark size="sm" />
          </Show>
          <button
            onClick={props.onToggleCollapse}
            class="p-1.5 rounded-md text-text-tertiary hover:bg-fill hover:text-text-primary transition-colors"
            aria-label={
              props.isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
            }
          >
            <PanelLeft class="w-[18px] h-[18px]" stroke-width={1.75} />
          </button>
        </div>

        {/* Navigation Sections */}
        <div class="flex-1 overflow-y-auto flex flex-col pb-1">
          {/* Chat Item with Plus */}
          <div class="mb-1">
            <Show when={!props.isCollapsed}>
              <h3 class="px-4 pt-3 pb-1 text-[11px] font-semibold text-text-muted">
                Chat
              </h3>
            </Show>
            <Show when={props.isCollapsed}>
              <div class="px-2 py-1">
                <div class="h-px bg-separator mx-1.5" />
              </div>
            </Show>
            <div class="flex items-center gap-0.5 px-2">
              <a
                href={RoutePaths.CHAT}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  props.onClearSession?.();
                  props.onNavigate('chat');
                  if (isMobileViewport()) {
                    props.onCollapse();
                  }
                }}
                class={`flex-1 ${rowClass(props.currentView === 'chat', props.isCollapsed)}`}
                title="Chat"
              >
                <MessageSquare
                  class="w-[18px] h-[18px] flex-shrink-0"
                  stroke-width={1.75}
                />
                <Show when={!props.isCollapsed}>
                  <span>Chat</span>
                </Show>
              </a>
              <Show when={!props.isCollapsed}>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={isCreating()}
                  class="h-8 w-8 flex items-center justify-center rounded-md text-text-tertiary hover:bg-fill hover:text-text-primary transition-colors"
                  title="New Session"
                  aria-label="New session"
                >
                  <Plus class="w-4 h-4" />
                </button>
              </Show>
            </div>

            {/* Quick-access sessions: Favorites + Recent. Hidden when collapsed. */}
            <Show when={!props.isCollapsed}>
              <SessionList
                sessions={props.sessions}
                selectedId={props.selectedSessionId}
                onSelect={(id) => {
                  props.onSelectSession(id);
                  if (isMobileViewport()) {
                    props.onCollapse();
                  }
                }}
                {...(props.onToggleFavorite
                  ? { onToggleFavorite: props.onToggleFavorite }
                  : {})}
                isLoading={props.isLoadingSessions ?? false}
                isCollapsed={props.isCollapsed}
                isActiveView={props.currentView === 'chat'}
              />
            </Show>
          </div>

          <For each={navSections}>
            {(section) => (
              <div class="mb-1">
                <Show when={!props.isCollapsed}>
                  <h3 class="px-4 pt-3 pb-1 text-[11px] font-semibold text-text-muted">
                    {section.title}
                  </h3>
                </Show>
                <Show when={props.isCollapsed}>
                  <div class="px-2 py-1">
                    <div class="h-px bg-separator mx-1.5" />
                  </div>
                </Show>
                <For each={section.items}>
                  {(item) => {
                    const Icon = item.icon;
                    return (
                      <a
                        href={viewToRouteMap[item.id]}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          props.onNavigate(item.id);
                          if (isMobileViewport()) {
                            props.onCollapse();
                          }
                        }}
                        class={`mx-2 ${rowClass(props.currentView === item.id, props.isCollapsed)}`}
                        title={item.label}
                      >
                        <span class="relative flex-shrink-0">
                          <Icon class="w-[18px] h-[18px]" stroke-width={1.75} />
                          <Show
                            when={
                              item.id === 'workflows' &&
                              props.isCollapsed &&
                              pendingApprovals().length > 0
                            }
                          >
                            <span class="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500" />
                          </Show>
                        </span>
                        <Show when={!props.isCollapsed}>
                          <span class="flex-1">{item.label}</span>
                          <Show
                            when={
                              item.id === 'workflows' &&
                              pendingApprovals().length > 0
                            }
                          >
                            <span
                              class="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-semibold flex items-center justify-center"
                              title={`${pendingApprovals().length} approval(s) waiting`}
                            >
                              {pendingApprovals().length}
                            </span>
                          </Show>
                        </Show>
                      </a>
                    );
                  }}
                </For>
                {/* Render enabled addon items under the Addons section */}
                <Show
                  when={
                    section.title === 'Addons' &&
                    (props.enabledAddons?.length ?? 0) > 0
                  }
                >
                  <For each={props.enabledAddons ?? []}>
                    {(addon) => (
                      <a
                        href={`/addons/${addon.addonId}`}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          props.onAddonSelect?.(addon);
                          if (isMobileViewport()) {
                            props.onCollapse();
                          }
                        }}
                        class={`mx-2 ${rowClass(props.activeAddonId === addon.addonId, props.isCollapsed)}`}
                        title={addon.name}
                      >
                        <Puzzle
                          class="w-[18px] h-[18px] flex-shrink-0"
                          stroke-width={1.75}
                        />
                        <Show when={!props.isCollapsed}>
                          <span class="truncate">{addon.name}</span>
                        </Show>
                      </a>
                    )}
                  </For>
                </Show>
              </div>
            )}
          </For>

          {/* Bottom Actions */}
          <div class="flex-1" />
          <div class="py-2.5 px-2 hairline-t space-y-1.5">
            <ThemeToggle isCollapsed={props.isCollapsed} />

            <a
              href={RoutePaths.SETTINGS}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                props.onNavigate('settings');
                if (isMobileViewport()) {
                  props.onCollapse();
                }
              }}
              class={rowClass(
                props.currentView === 'settings',
                props.isCollapsed,
              )}
              title="Settings"
            >
              <span class="relative flex-shrink-0">
                <Settings class="w-[18px] h-[18px]" stroke-width={1.75} />
                {/* Update-available indicator (issue #456). Shown in both
                    collapsed and expanded states so the nudge isn't lost when
                    the sidebar is narrow. */}
                <Show when={updateBadgeVisible()}>
                  <span
                    class="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary ring-2 ring-white dark:ring-gray-900"
                    aria-label="Update available"
                  />
                </Show>
              </span>
              <Show when={!props.isCollapsed}>
                <span class="flex-1 text-left">Settings</span>
              </Show>
              <Show when={!props.isCollapsed && updateBadgeVisible()}>
                <span class="text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Update
                </span>
              </Show>
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
