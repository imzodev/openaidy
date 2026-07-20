import { PauseCircle, PlayCircle } from 'lucide-solid';

export type PausedRunNoticeProps = {
  /** Send a "continue" turn to resume where the agent left off. */
  onContinue: () => void;
};

/**
 * Shown when the latest run finished with finish_reason `tool_calls` — the
 * agent wanted to keep going but the turn ended (hit its step limit, or a
 * degenerate empty turn). Without this, such a run looks complete and the
 * user has to guess that they need to type "continue". Surfaces an explicit
 * paused state with a one-click resume.
 */
export function PausedRunNotice(props: PausedRunNoticeProps) {
  return (
    <div
      role="status"
      class="mx-4 my-2 flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 shadow-sm"
    >
      <PauseCircle class="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
          Paused — the agent stopped before finishing
        </p>
        <p class="text-xs text-amber-700 dark:text-amber-300/80">
          It reached its step limit for that turn. Continue to pick up where it
          left off.
        </p>
      </div>
      <button
        type="button"
        onClick={() => props.onContinue()}
        class="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-500"
      >
        <PlayCircle class="w-4 h-4" />
        Continue
      </button>
    </div>
  );
}
