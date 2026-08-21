// apps/web/src/components/DesktopStatusBar.tsx
import { createSignal, onMount, Show } from 'solid-js';
import type { Update } from '@tauri-apps/plugin-updater';
import { useTauri } from '../lib/tauri-provider';
import {
  restartService,
  checkForUpdate,
  installUpdate,
} from '../lib/tauri-bridge';

type Phase = 'idle' | 'checking' | 'available' | 'installing' | 'error';

function UpdateNotice() {
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [pendingUpdate, setPendingUpdate] = createSignal<Update | null>(null);
  const [installingPct, setInstallingPct] = createSignal<number | null>(null);
  const [errorMessage, setErrorMessage] = createSignal('');

  // One check per app launch, not on a timer — a stray desktop app left
  // open for days shouldn't hammer the GitHub Releases endpoint, and
  // there's no urgency to a background poll for something the user has
  // to click through anyway.
  onMount(async () => {
    setPhase('checking');
    try {
      const update = await checkForUpdate();
      if (update) {
        setPendingUpdate(update);
        setPhase('available');
      } else {
        setPhase('idle');
      }
    } catch (e) {
      console.error('[updater] check failed:', e);
      setPhase('idle');
    }
  });

  const install = async () => {
    const update = pendingUpdate();
    if (!update) return;
    setPhase('installing');
    setInstallingPct(null);
    try {
      await installUpdate(update, (downloaded, total) => {
        if (total != null)
          setInstallingPct(Math.round((downloaded / total) * 100));
      });
      // installUpdate relaunches on success — nothing left to render.
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  return (
    <>
      <Show when={phase() === 'available'}>
        <button onClick={install} class="text-blue-500 hover:underline">
          Update available — install &amp; restart
        </button>
      </Show>
      <Show when={phase() === 'installing'}>
        <span class="text-gray-500">
          Installing update…
          {installingPct() != null && ` ${installingPct()}%`}
        </span>
      </Show>
      <Show when={phase() === 'error'}>
        <span class="text-red-500" title={errorMessage()}>
          Update failed
        </span>
      </Show>
    </>
  );
}

export function DesktopStatusBar() {
  const { isDesktop, serviceStatus, isConnected } = useTauri();

  if (!isDesktop) return null;

  return (
    <div class="flex items-center gap-2 text-sm">
      <span
        class={`w-2 h-2 rounded-full ${
          isConnected() ? 'bg-green-500' : 'bg-red-500'
        }`}
        title={serviceStatus()?.state ?? 'Disconnected'}
      />
      <span class="text-gray-500">
        {isConnected()
          ? `Desktop (port ${serviceStatus()?.port})`
          : 'Service stopped'}
      </span>
      {!isConnected() && (
        <button
          onClick={async () => {
            try {
              await restartService();
            } catch (e) {
              console.error('Restart failed:', e);
            }
          }}
          class="text-blue-500 hover:underline"
        >
          Restart
        </button>
      )}
      <UpdateNotice />
    </div>
  );
}
