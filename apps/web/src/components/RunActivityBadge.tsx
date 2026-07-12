import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { Loader, Ban } from 'lucide-solid';

export type RunActivityPhase =
  | 'thinking'
  | 'running_tool'
  | 'cancelled'
  | 'failed';

type RunActivityBadgeProps = {
  /** What the agent is currently doing. */
  phase: RunActivityPhase;
  /** Tool name shown when `phase` is `running_tool`. */
  toolName?: string;
  /** Server-reported run elapsed time (ms); the badge ticks locally from here. */
  elapsedMs: number;
};

/**
 * Small read-only pill above the streaming message that surfaces what the
 * agent is doing between events — "Thinking…" or "Running <tool>… 12s" — with
 * a locally-ticking elapsed counter (issue #378). The server drives the phase
 * via `session.stream.activity`; the seconds are interpolated client-side so
 * the counter is smooth without flooding the WS.
 */
export function RunActivityBadge(props: RunActivityBadgeProps) {
  const [displayMs, setDisplayMs] = createSignal(props.elapsedMs);

  const isTerminal = () =>
    props.phase === 'cancelled' || props.phase === 'failed';

  // Re-anchor whenever the server sends a fresh elapsed value or the phase
  // changes, then tick locally every 250ms. Terminal phases don't tick. The
  // effect's onCleanup clears the prior interval, so nothing leaks.
  createEffect(() => {
    const serverMs = props.elapsedMs;
    setDisplayMs(serverMs);
    if (isTerminal()) return;
    const anchor = Date.now() - serverMs;
    const timer = setInterval(() => setDisplayMs(Date.now() - anchor), 250);
    onCleanup(() => clearInterval(timer));
  });

  const seconds = () => Math.max(0, Math.floor(displayMs() / 1000));

  const label = () => {
    switch (props.phase) {
      case 'running_tool':
        return `Running ${props.toolName ?? 'tool'}…`;
      case 'cancelled':
        return 'Cancelled';
      case 'failed':
        return 'Failed';
      default:
        return 'Thinking…';
    }
  };

  return (
    <div
      aria-live="polite"
      class={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
        isTerminal()
          ? 'border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
          : 'border-gray-200 dark:border-gray-700 text-text-tertiary'
      }`}
    >
      <Show
        when={!isTerminal()}
        fallback={<Ban class="w-3 h-3 flex-shrink-0" />}
      >
        <Loader class="w-3 h-3 flex-shrink-0 animate-spin" />
      </Show>
      <span>{label()}</span>
      <Show when={!isTerminal()}>
        <span class="tabular-nums opacity-70">{seconds()}s</span>
      </Show>
    </div>
  );
}
