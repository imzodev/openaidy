import { createSignal, onMount, onCleanup } from 'solid-js';
import type { ViewType } from '../components/Sidebar';

// Route path constants - single source of truth
export const RoutePaths = {
  SESSIONS: '/sessions',
  CHAT: '/chat',
  TASKS: '/tasks',
  PULSES: '/pulses',
  CHANNELS: '/channels',
  WEBHOOKS: '/webhooks',
  AGENTS: '/agents',
  SKILLS: '/skills',
  MCPS: '/mcps',
  LOGS: '/logs',
  BACKUPS: '/backups',
  ADDONS: '/addons',
  API_KEYS: '/api-keys',
  SETTINGS: '/settings',
} as const;

export type RoutePath = (typeof RoutePaths)[keyof typeof RoutePaths];

// Map ViewType to RoutePaths
export const viewToRouteMap: Record<ViewType, RoutePath> = {
  sessions: RoutePaths.SESSIONS,
  chat: RoutePaths.CHAT,
  tasks: RoutePaths.TASKS,
  pulses: RoutePaths.PULSES,
  channels: RoutePaths.CHANNELS,
  webhooks: RoutePaths.WEBHOOKS,
  agents: RoutePaths.AGENTS,
  skills: RoutePaths.SKILLS,
  mcps: RoutePaths.MCPS,
  logs: RoutePaths.LOGS,
  backups: RoutePaths.BACKUPS,
  addons: RoutePaths.ADDONS,
  'api-keys': RoutePaths.API_KEYS,
  settings: RoutePaths.SETTINGS,
};

// Map RoutePaths to ViewType
export const routeToViewMap: Record<string, ViewType> = {
  '/': 'chat',
  [RoutePaths.SESSIONS]: 'sessions',
  [RoutePaths.CHAT]: 'chat',
  [RoutePaths.TASKS]: 'tasks',
  [RoutePaths.PULSES]: 'pulses',
  [RoutePaths.CHANNELS]: 'channels',
  [RoutePaths.WEBHOOKS]: 'webhooks',
  [RoutePaths.AGENTS]: 'agents',
  [RoutePaths.SKILLS]: 'skills',
  [RoutePaths.MCPS]: 'mcps',
  [RoutePaths.LOGS]: 'logs',
  [RoutePaths.BACKUPS]: 'backups',
  [RoutePaths.ADDONS]: 'addons',
  [RoutePaths.API_KEYS]: 'api-keys',
  [RoutePaths.SETTINGS]: 'settings',
};

// Default route
export const DEFAULT_ROUTE = RoutePaths.CHAT;

/**
 * Custom router hook for managing URL-based navigation
 * Uses history API for navigation and popstate for back/forward support
 */
export function createRouter() {
  // Handle root path redirect on initial load
  const getInitialPath = () => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      // Redirect root to chat
      if (path === '/') {
        window.history.replaceState({}, '', RoutePaths.CHAT);
        return RoutePaths.CHAT;
      }
      return path;
    }
    return DEFAULT_ROUTE;
  };

  const [currentPath, setCurrentPath] = createSignal(getInitialPath());

  // Get current view from path
  const currentView = (): ViewType => {
    const path = currentPath();
    return routeToViewMap[path] || 'sessions';
  };

  // Navigate to a view by updating the URL
  const navigate = (view: ViewType) => {
    const newPath = viewToRouteMap[view];
    if (newPath && typeof window !== 'undefined') {
      window.history.pushState({}, '', newPath);
      setCurrentPath(newPath);
    }
  };

  // Handle browser back/forward
  const handlePopState = () => {
    setCurrentPath(window.location.pathname);
  };

  // Set up popstate listener on mount
  onMount(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopState);
    }
  });

  // Clean up on unmount
  onCleanup(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', handlePopState);
    }
  });

  return {
    currentPath,
    currentView,
    navigate,
  };
}

/**
 * Navigate to a specific path directly
 */
export function navigateTo(path: RoutePath) {
  if (typeof window !== 'undefined') {
    window.history.pushState({}, '', path);
  }
}

/**
 * Get current URL path
 */
export function getCurrentPath(): string {
  if (typeof window !== 'undefined') {
    return window.location.pathname;
  }
  return DEFAULT_ROUTE;
}
