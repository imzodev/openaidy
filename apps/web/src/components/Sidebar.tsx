import { Show, createSignal } from 'solid-js';
import { Plus, Settings, ChevronLeft, ChevronRight } from 'lucide-solid';
import { SessionList } from './SessionList';
import { ThemeToggle } from './ThemeToggle';
import type { Session } from '../lib/api';

type SidebarProps = {
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  isLoadingSessions?: boolean;
  currentView: 'chat' | 'settings';
  onNavigate: (view: 'chat' | 'settings') => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onCollapse: () => void;
};

export function Sidebar(props: SidebarProps) {
  const [isCreating, setIsCreating] = createSignal(false);

  const isMobileViewport = () =>
    typeof window !== 'undefined' && window.innerWidth < 768;

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await props.onCreateSession();
      // Ensure we navigate back to chat when a new session is created
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
          class={`py-2 border-b border-gray-200 dark:border-gray-700 flex items-center h-[54px] ${
            props.isCollapsed ? 'justify-center px-0' : 'justify-between px-4'
          }`}
        >
          <Show when={!props.isCollapsed}>
            <h1 class="text-xl font-bold text-gray-900 dark:text-white truncate tracking-tight">
              OpenAidy
            </h1>
          </Show>
          <button
            onClick={props.onToggleCollapse}
            class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 transition-colors"
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
            class={`flex items-center justify-center gap-2 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg transition-colors ${
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

        {/* Navigation & Sessions */}
        <div class="flex-1 overflow-y-auto flex flex-col">
          {/* Main List */}
          <div class="flex-1">
            <SessionList
              sessions={props.sessions}
              selectedId={props.selectedSessionId}
              onSelect={(id) => {
                props.onSelectSession(id);
                props.onNavigate('chat');
                if (isMobileViewport()) {
                  props.onCollapse();
                }
              }}
              isLoading={props.isLoadingSessions}
              isCollapsed={props.isCollapsed}
              isActiveView={props.currentView === 'chat'}
            />
          </div>

          {/* Bottom Actions */}
          <div
            class={`py-3 border-t border-gray-200 dark:border-gray-700 ${props.isCollapsed ? 'px-2' : 'px-3'} space-y-2`}
          >
            <ThemeToggle isCollapsed={props.isCollapsed} />

            <button
              onClick={() => {
                props.onNavigate('settings');
                if (isMobileViewport()) {
                  props.onCollapse();
                }
              }}
              class={`w-full flex items-center gap-2 py-2 rounded-lg transition-colors ${
                props.currentView === 'settings'
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'
              } ${props.isCollapsed ? 'justify-center px-0' : 'px-3 justify-start'}`}
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
