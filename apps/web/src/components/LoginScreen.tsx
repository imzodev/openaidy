import { createSignal, onMount } from 'solid-js';
import { verifyToken } from '../lib/api';
import { consumeTokenFromUrl, storeToken } from '../lib/auth-token';
import { getBootstrapAdminToken } from '../lib/tauri-bridge';

type LoginScreenProps = {
  onAuthenticated: () => void;
};

export function LoginScreen(props: LoginScreenProps) {
  // Pre-fill from ?token=... so deep-linked installs only need a single click
  // on "Connect". The URL parameter is consumed (stripped from the address
  // bar) by consumeTokenFromUrl so it does not linger in history.
  const [token, setToken] = createSignal(consumeTokenFromUrl() ?? '');
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [isVerifying, setIsVerifying] = createSignal(false);

  // Desktop app: the spawned server writes its own bootstrap-admin token to
  // disk, so there's no separate "admin" to hand a deep link out — read it
  // back via IPC and pre-fill the same way, rather than leaving a desktop
  // user with no way to discover their token short of digging through
  // %APPDATA%. Async (goes through Tauri IPC), so this can't live in the
  // signal's initializer above; only fills in if nothing else already did
  // (a ?token=... deep link, if present, wins).
  onMount(async () => {
    if (token()) return;
    const desktopToken = await getBootstrapAdminToken().catch(() => null);
    if (desktopToken && !token()) {
      setToken(desktopToken);
    }
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const value = token().trim();
    if (!value) return;

    setIsVerifying(true);
    setError(undefined);

    try {
      const result = await verifyToken(value);
      if (result.valid) {
        storeToken(result.token ?? value);
        props.onAuthenticated();
      } else {
        setError(result.error);
      }
    } catch {
      setError('Could not reach the server. Please check your connection.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div class="w-full max-w-md md:max-w-2xl">
        <div class="text-center mb-8">
          <img
            src="/logo.webp"
            alt="OpenAidy"
            class="h-32 md:h-56 w-auto mx-auto mb-8"
          />
          <p class="mt-2 text-sm text-text-secondary">
            {token()
              ? 'Token pre-filled. Press Connect to continue.'
              : 'Enter your API token to continue'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-border p-6 space-y-4"
        >
          <div>
            <label
              for="token-input"
              class="block text-sm font-medium text-text-primary mb-1.5"
            >
              API Token
            </label>
            <textarea
              id="token-input"
              rows={4}
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              placeholder="Paste your token here..."
              class="w-full px-3 py-2 rounded-lg border border-border bg-gray-50 dark:bg-gray-900 text-text-primary text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
              disabled={isVerifying()}
            />
          </div>

          {error() && (
            <p class="text-sm text-red-500 dark:text-red-400">{error()}</p>
          )}

          <button
            type="submit"
            disabled={!token().trim() || isVerifying()}
            class="w-full py-2 px-4 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isVerifying() ? 'Verifying…' : 'Connect'}
          </button>
        </form>

        <p class="mt-4 text-center text-xs text-text-tertiary">
          Get your token from the server administrator or via{' '}
          <code class="font-mono">pnpm openaidy admin token show</code>
        </p>
      </div>
    </div>
  );
}
