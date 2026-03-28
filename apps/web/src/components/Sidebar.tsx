import { Show, For, createSignal } from 'solid-js';
import {
  Plus,
  Settings,
  ChevronLeft,
  ChevronRight,
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
} from 'lucide-solid';
import { ThemeToggle } from './ThemeToggle';
import type { Session } from '../lib/api';

export type ViewType =
  | 'chat'
  | 'sessions'
  | 'tasks'
  | 'pulses'
  | 'channels'
  | 'webhooks'
  | 'agents'
  | 'skills'
  | 'mcps'
  | 'logs'
  | 'backups'
  | 'addons'
  | 'settings';

type SidebarProps = {
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  isLoadingSessions?: boolean;
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onCollapse: () => void;
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
      { id: 'sessions', label: 'Sessions', icon: MessageSquare },
      { id: 'tasks', label: 'Tasks', icon: CheckSquare },
      { id: 'pulses', label: 'Pulses', icon: Zap },
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
      { id: 'skills', label: 'Skills', icon: Wrench },
      { id: 'mcps', label: 'MCP Servers', icon: Server },
    ],
  },
  {
    title: 'System',
    items: [
      { id: 'logs', label: 'Logs', icon: FileText },
      { id: 'backups', label: 'Backups', icon: Save },
    ],
  },
  {
    title: 'Addons',
    items: [{ id: 'addons', label: 'Addons', icon: Puzzle }],
  },
];

export function Sidebar(props: SidebarProps) {
  const [isCreating, setIsCreating] = createSignal(false);

  const isMobileViewport = () =>
    typeof window !== 'undefined' && window.innerWidth < 768;

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await props.onCreateSession();
      props.onNavigate('sessions');
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
          class="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={props.onCollapse}
        />
      </Show>

      <aside
        class={`fixed inset-y-0 left-0 z-40 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full transition-all duration-300 md:relative md:z-auto md:flex-shrink-0 ${
          props.isCollapsed
            ? '-translate-x-full w-64 max-w-[85vw] md:translate-x-0 md:w-12'
            : 'translate-x-0 w-64 max-w-[85vw]'
        }`}
      >
        {/* Header */}
        <div
          class={`py-2 border-b border-gray-200 dark:border-gray-700 flex items-center h-[55px] ${
            props.isCollapsed ? 'justify-center px-0' : 'justify-between px-4'
          }`}
        >
          <Show when={!props.isCollapsed}>
            <h1 class="text-xl font-bold text-text-primary truncate tracking-tight">
              OpenAidy
            </h1>
          </Show>
          <button
            onClick={props.onToggleCollapse}
            class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-text-tertiary transition-colors"
            aria-label={
              props.isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
            }
          >
            {props.isCollapsed ? (
              <ChevronRight class="w-5 h-5" />
            ) : (
              <ChevronLeft class="w-5 h-5" />
            )}
          </button>
        </div>

        {/* New Session Button */}
        <div class={`py-3 ${props.isCollapsed ? 'px-2' : 'px-3'}`}>
          <button
            onClick={handleCreate}
            disabled={isCreating()}
            class={`flex items-center justify-center gap-2 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg transition-colors ${
              props.isCollapsed ? 'w-full px-0' : 'w-full px-4'
            }`}
            title="New Session"
          >
            <Show when={isCreating()}>
              <span class="animate-pulse">...</span>
            </Show>
            <Show when={!isCreating()}>
              <Plus class="w-4 h-4" />
              <Show when={!props.isCollapsed}>
                <span>New Session</span>
              </Show>
            </Show>
          </button>
        </div>

        {/* Navigation Sections */}
        <div class="flex-1 overflow-y-auto flex flex-col">
          <For each={navSections}>
            {(section) => (
              <div class="mb-2">
                <Show when={!props.isCollapsed}>
                  <h3 class="px-4 py-1 text-xs font-semibold text-text-muted uppercase tracking-wider">
                    {section.title}
                  </h3>
                </Show>
                <Show when={props.isCollapsed}>
                  <div class="px-2 py-1">
                    <div class="h-px bg-gray-200 dark:bg-gray-700" />
                  </div>
                </Show>
                <For each={section.items}>
                  {(item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          props.onNavigate(item.id);
                          if (isMobileViewport()) {
                            props.onCollapse();
                          }
                        }}
                        class={`w-full flex items-center gap-2 py-2 rounded-lg transition-colors ${
                          props.currentView === item.id
                            ? 'bg-blue-50 dark:bg-blue-900/20 text-text-primary'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary'
                        } ${
                          props.isCollapsed
                            ? 'justify-center px-0'
                            : 'px-4 justify-start'
                        }`}
                        title={item.label}
                      >
                        <Icon class="w-5 h-5 flex-shrink-0" />
                        <Show when={!props.isCollapsed}>
                          <span class="text-sm">{item.label}</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>

          {/* Bottom Actions */}
          <div class="flex-1" />
          <div
            class={`py-3 border-t border-gray-200 dark:border-gray-700 ${
              props.isCollapsed ? 'px-2' : 'px-3'
            } space-y-2`}
          >
            <ThemeToggle isCollapsed={props.isCollapsed} />

            <button
              type="button"
              onClick={() => {
                props.onNavigate('settings');
                if (isMobileViewport()) {
                  props.onCollapse();
                }
              }}
              class={`w-full flex items-center gap-2 py-2 rounded-lg transition-colors ${
                props.currentView === 'settings'
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-text-primary'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary'
              } ${
                props.isCollapsed ? 'justify-center px-0' : 'px-3 justify-start'
              }`}
              title="Settings"
            >
              <Settings class="w-5 h-5 flex-shrink-0" />
              <Show when={!props.isCollapsed}>
                <span>Settings</span>
              </Show>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
