import { createResource, createSignal, For, Show } from 'solid-js';
import { Layout } from './Layout';
import { getUsage } from '../../lib/api';
import type { UsageByDay, UsageReport } from '../../lib/types';

type RangePreset = '7d' | '30d' | '90d' | 'all';

const RANGE_LABELS: Record<RangePreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
};

/** Compute the ISO `from` bound for a preset (undefined for 'all'). */
function fromForPreset(preset: RangePreset): string | undefined {
  if (preset === 'all') return undefined;
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return from.toISOString();
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(cost: number, hasCost: boolean): string {
  if (!hasCost) return '—';
  // Small costs need more precision than cents.
  const digits = cost > 0 && cost < 1 ? 4 : 2;
  return `$${cost.toFixed(digits)}`;
}

/**
 * Daily token bar chart. Single series (magnitude), so no legend — one hue,
 * thin bars with rounded tops anchored to the baseline. Purely presentational
 * inline SVG so it stays self-contained (no chart dependency).
 */
function DailyChart(props: { byDay: UsageByDay[] }) {
  const max = () => Math.max(1, ...props.byDay.map((d) => d.totalTokens));

  const width = 720;
  const height = 180;
  const padBottom = 22;
  const padTop = 8;
  const gap = 3;

  const barWidth = () => {
    const n = props.byDay.length || 1;
    return Math.max(2, (width - gap * (n - 1)) / n);
  };

  // Show at most ~8 date labels to avoid collisions.
  const labelEvery = () => Math.max(1, Math.ceil(props.byDay.length / 8));

  return (
    <Show
      when={props.byDay.length > 0}
      fallback={
        <div class="flex items-center justify-center h-44 text-text-tertiary text-sm">
          No usage in this range
        </div>
      }
    >
      <div class="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          class="w-full min-w-[480px]"
          role="img"
          aria-label="Daily token usage"
        >
          <For each={props.byDay}>
            {(day, i) => {
              const bw = barWidth();
              const x = i() * (bw + gap);
              const usableH = height - padBottom - padTop;
              const h = (day.totalTokens / max()) * usableH;
              const y = height - padBottom - h;
              const showLabel = i() % labelEvery() === 0;
              return (
                <>
                  <rect
                    x={x}
                    y={y}
                    width={bw}
                    height={Math.max(0, h)}
                    rx={2}
                    class="fill-primary"
                  >
                    <title>
                      {day.day}: {formatNumber(day.totalTokens)} tokens
                      {day.hasCost ? `, ${formatCost(day.cost, true)}` : ''}
                    </title>
                  </rect>
                  <Show when={showLabel}>
                    <text
                      x={x + bw / 2}
                      y={height - 6}
                      text-anchor="middle"
                      class="fill-text-tertiary"
                      style={{ 'font-size': '9px' }}
                    >
                      {day.day.slice(5)}
                    </text>
                  </Show>
                </>
              );
            }}
          </For>
        </svg>
      </div>
    </Show>
  );
}

function StatTile(props: { label: string; value: string; hint?: string }) {
  return (
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div class="text-xs text-text-tertiary">{props.label}</div>
      <div class="mt-1 text-2xl font-semibold text-text-primary tabular-nums">
        {props.value}
      </div>
      <Show when={props.hint}>
        <div class="mt-0.5 text-xs text-text-tertiary">{props.hint}</div>
      </Show>
    </div>
  );
}

export function UsagePage() {
  const [range, setRange] = createSignal<RangePreset>('30d');

  const [report] = createResource<UsageReport | null, RangePreset>(
    range,
    async (preset) => {
      const from = fromForPreset(preset);
      const result = await getUsage(from ? { from } : {});
      if ('error' in result) return null;
      return result;
    },
  );

  const totals = () => report()?.totals;

  return (
    <Layout
      title="Usage"
      description="Token usage and estimated cost across all sessions"
      actions={
        <div class="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
          <For each={Object.keys(RANGE_LABELS) as RangePreset[]}>
            {(preset) => (
              <button
                type="button"
                onClick={() => setRange(preset)}
                class={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  range() === preset
                    ? 'bg-primary text-white'
                    : 'text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {RANGE_LABELS[preset]}
              </button>
            )}
          </For>
        </div>
      }
    >
      <Show
        when={!report.loading}
        fallback={
          <div class="flex items-center justify-center h-64 text-text-tertiary">
            Loading usage…
          </div>
        }
      >
        <Show
          when={report()}
          fallback={
            <div class="flex items-center justify-center h-64 text-text-tertiary">
              Failed to load usage
            </div>
          }
        >
          {/* Headline stat tiles */}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatTile
              label="Total tokens"
              value={formatNumber(totals()?.totalTokens ?? 0)}
              hint={`${formatNumber(totals()?.runCount ?? 0)} runs`}
            />
            <StatTile
              label="Prompt tokens"
              value={formatNumber(totals()?.promptTokens ?? 0)}
              hint={
                (totals()?.cacheReadTokens ?? 0) > 0
                  ? `${formatNumber(totals()!.cacheReadTokens)} cached`
                  : undefined
              }
            />
            <StatTile
              label="Completion tokens"
              value={formatNumber(totals()?.completionTokens ?? 0)}
            />
            <StatTile
              label="Estimated cost"
              value={formatCost(
                totals()?.cost ?? 0,
                totals()?.hasCost ?? false,
              )}
              hint={
                totals() && !totals()!.hasCost
                  ? 'No pricing for these models'
                  : undefined
              }
            />
          </div>

          {/* Daily usage chart */}
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
            <h2 class="text-sm font-medium text-text-primary mb-3">
              Tokens per day
            </h2>
            <DailyChart byDay={report()?.byDay ?? []} />
          </div>

          {/* Breakdown by model (doubles as the accessible table view) */}
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            <h2 class="text-sm font-medium text-text-primary px-4 pt-4 pb-2">
              By model
            </h2>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-xs text-text-tertiary border-b border-gray-200 dark:border-gray-700">
                    <th class="px-4 py-2 font-medium">Provider</th>
                    <th class="px-4 py-2 font-medium">Model</th>
                    <th class="px-4 py-2 font-medium text-right">Runs</th>
                    <th class="px-4 py-2 font-medium text-right">Prompt</th>
                    <th class="px-4 py-2 font-medium text-right">Completion</th>
                    <th class="px-4 py-2 font-medium text-right">Total</th>
                    <th class="px-4 py-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <Show
                    when={(report()?.byModel.length ?? 0) > 0}
                    fallback={
                      <tr>
                        <td
                          colspan="7"
                          class="px-4 py-6 text-center text-text-tertiary"
                        >
                          No usage in this range
                        </td>
                      </tr>
                    }
                  >
                    <For each={report()?.byModel ?? []}>
                      {(row) => (
                        <tr class="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                          <td class="px-4 py-2 text-text-secondary">
                            {row.providerId}
                          </td>
                          <td class="px-4 py-2 text-text-primary">
                            {row.modelId}
                          </td>
                          <td class="px-4 py-2 text-right tabular-nums text-text-secondary">
                            {formatNumber(row.runCount)}
                          </td>
                          <td class="px-4 py-2 text-right tabular-nums text-text-secondary">
                            {formatNumber(row.promptTokens)}
                          </td>
                          <td class="px-4 py-2 text-right tabular-nums text-text-secondary">
                            {formatNumber(row.completionTokens)}
                          </td>
                          <td class="px-4 py-2 text-right tabular-nums text-text-primary">
                            {formatNumber(row.totalTokens)}
                          </td>
                          <td class="px-4 py-2 text-right tabular-nums text-text-secondary">
                            {formatCost(row.cost, row.hasCost)}
                          </td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            </div>
          </div>
        </Show>
      </Show>
    </Layout>
  );
}
