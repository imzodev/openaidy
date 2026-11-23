import { createSignal, onMount } from 'solid-js';
import { verifyToken } from '../lib/api';
import { consumeTokenFromUrl, storeToken } from '../lib/auth-token';
import { getBootstrapAdminToken } from '../lib/tauri-bridge';
import { Wordmark } from './ui/Wordmark';

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
    <div class="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-5 py-10 relative overflow-hidden">
      {/* Soft ambient glow behind the card, in the icon's colors. */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-[640px] h-[640px] rounded-full opacity-40 dark:opacity-25 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(10,132,255,0.35) 0%, rgba(94,92,230,0.22) 40%, rgba(191,90,242,0) 70%)',
        }}
      />

      <div class="relative w-full max-w-[400px] animate-rise-in">
        <div class="text-center mb-8">
          <Wordmark iconOnly size="xl" class="mb-5" />
          <h1 class="text-[28px] font-bold tracking-tight text-text-primary">
            Sign in to Aidy
          </h1>
          <p class="mt-1.5 text-[15px] text-text-tertiary">
            {token()
              ? 'Token pre-filled. Press Connect to continue.'
              : 'Enter your API token to continue'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          class="material-sheet rounded-2xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 p-5 space-y-4"
        >
          <div>
            <label
              for="token-input"
              class="block text-[13px] font-medium text-text-secondary mb-1.5 ml-0.5"
            >
              API Token
            </label>
            <textarea
              id="token-input"
              rows={3}
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              placeholder="Paste your token here…"
              spellcheck={false}
              autocomplete="off"
              class="w-full px-3.5 py-2.5 rounded-xl bg-fill text-text-primary text-[13px] font-mono resize-none placeholder-text-muted focus:outline-none focus:ring-[3px] focus:ring-blue-500/35 transition-shadow break-all"
              disabled={isVerifying()}
            />
          </div>

          {error() && (
            <p
              role="alert"
              class="text-[13px] text-red-600 dark:text-red-400 ml-0.5"
            >
              {error()}
            </p>
          )}

          <button
            type="submit"
            disabled={!token().trim() || isVerifying()}
            class="w-full h-11 px-4 bg-primary hover:bg-primary-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-white/80 text-white text-[15px] font-semibold rounded-xl shadow-sm transition-colors"
          >
            {isVerifying() ? 'Verifying…' : 'Connect'}
          </button>
        </form>

        <p class="mt-5 text-center text-xs text-text-muted leading-relaxed">
          Get your token from the server administrator or run{' '}
          <code class="font-mono px-1.5 py-0.5 rounded-md bg-fill text-text-tertiary whitespace-nowrap">
            aidy admin token show
          </code>
        </p>
      </div>
    </div>
  );
}
