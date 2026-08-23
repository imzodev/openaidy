/**
 * TauriProvider — wraps the app with Tauri-specific context.
 *
 * Provides:
 * - Service status polling (for status bar display)
 * - Tauri event listeners (service crashed, etc.)
 * - `isDesktop` flag for conditional rendering
 */

import {
  createContext,
  useContext,
  createSignal,
  onMount,
  onCleanup,
  type ParentComponent,
} from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getServiceStatus, type ServiceStatus } from './tauri-bridge';

interface TauriContextValue {
  isDesktop: boolean;
  serviceStatus: () => ServiceStatus | null;
  isConnected: () => boolean;
}

const TauriContext = createContext<TauriContextValue>();

export const TauriProvider: ParentComponent = (props) => {
  const [serviceStatus, setServiceStatus] = createSignal<ServiceStatus | null>(
    null,
  );
  const [unlisten, setUnlisten] = createSignal<UnlistenFn[]>([]);

  onMount(async () => {
    if (!isTauri()) {
      return;
    }

    // Poll service status every 5 seconds
    const interval = setInterval(async () => {
      try {
        const status = await getServiceStatus();
        setServiceStatus(status);
      } catch (e) {
        console.warn('Failed to get service status:', e);
      }
    }, 5000);

    // Listen for service events
    const unlistenCrash = await listen('service-crashed', (event) => {
      console.error('Service crashed:', event.payload);
      setServiceStatus(null);
    });

    setUnlisten([...unlisten(), unlistenCrash, () => clearInterval(interval)]);
  });

  onCleanup(() => {
    for (const fn of unlisten()) {
      fn();
    }
  });

  const isConnected = () => {
    const s = serviceStatus();
    return s !== null && s.state === 'Running';
  };

  const value: TauriContextValue = {
    isDesktop: isTauri(),
    serviceStatus,
    isConnected,
  };

  return (
    <TauriContext.Provider value={value}>
      {props.children}
    </TauriContext.Provider>
  );
};

export function useTauri() {
  const ctx = useContext(TauriContext);
  if (!ctx) {
    throw new Error('useTauri must be used inside <TauriProvider>');
  }
  return ctx;
}
