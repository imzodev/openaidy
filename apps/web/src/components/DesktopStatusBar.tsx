// apps/web/src/components/DesktopStatusBar.tsx
import { useTauri } from '../lib/tauri-provider';
import { restartService } from '../lib/tauri-bridge';

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
    </div>
  );
}
