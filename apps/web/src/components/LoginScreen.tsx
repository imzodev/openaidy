import { createSignal } from 'solid-js';
import { verifyToken } from '../lib/api';
import { storeToken } from '../lib/auth-token';

type LoginScreenProps = {
  onAuthenticated: () => void;
};

export function LoginScreen(props: LoginScreenProps) {
  const [token, setToken] = createSignal('');
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [isVerifying, setIsVerifying] = createSignal(false);

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
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-text-primary">OpenAidy</h1>
          <p class="mt-2 text-sm text-text-secondary">
            Enter your API token to continue
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
