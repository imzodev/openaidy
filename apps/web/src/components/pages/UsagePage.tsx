import { createResource, createSignal, For, Show } from 'solid-js';
import { Layout } from './Layout';
import { getUsage } from '../../lib/api';
import type {
  UsageByDay,
  UsageByDayAndModel,
  UsageByModel,
  UsageReport,
} from '../../lib/types';
import { formatNumber, formatCost } from '../../lib/usage-format';

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

/**
 * Stable color palette for the stacked-bar chart. Models are assigned
 * colors by descending totalTokens (top spender = palette[0], second =
 * palette[1], ...). The palette wraps after 10 entries; if a project has
 * more than 10 models the chart becomes hard to read but stays honest —
 * every model still gets a visible segment and a legend entry.
 *
 * Why Tailwind classes and not raw hex: the rest of this file already
 * uses Tailwind classes for SVG fill (`fill-primary`), and the same
 * classes work for the legend swatches below.
 */
const CHART_PALETTE = [
  'fill-blue-500',
  'fill-emerald-500',
  'fill-amber-500',
  'fill-violet-500',
  'fill-rose-500',
  'fill-cyan-500',
  'fill-orange-500',
  'fill-lime-500',
  'fill-pink-500',
  'fill-indigo-500',
] as const;

const FILL_OVERFLOW = 'fill-gray-300 dark:fill-gray-600';

/** Stable model-key → CSS-class assignment, sorted by totalTokens desc. */
function buildModelColorMap(byModel: UsageByModel[]): Map<string, string> {
  const map = new Map<string, string>();
  byModel.forEach((row, i) => {
    const key = `${row.providerId}/${row.modelId}`;
    map.set(key, CHART_PALETTE[i % CHART_PALETTE.length] ?? FILL_OVERFLOW);
  });
  return map;
}

/**
 * Index `byDayByModel` rows by day so each bar can find its segments in
 * O(1). Inner key is the model key so we can pull total tokens per model
 * per day without scanning.
 */
function indexSegmentsByDay(
  rows: UsageByDayAndModel[],
): Map<string, Map<string, UsageByDayAndModel>> {
  const out = new Map<string, Map<string, UsageByDayAndModel>>();
  for (const row of rows) {
    const modelKey = `${row.providerId}/${row.modelId}`;
    let dayMap = out.get(row.day);
    if (!dayMap) {
      dayMap = new Map();
      out.set(row.day, dayMap);
    }
    dayMap.set(modelKey, row);
  }
  return out;
}

/**
 * Stacked daily token-usage chart. Each bar = one day; bar height = that
 * day's total tokens; bar segments = per-model contributions, colored
 * stably by rank (top model = palette[0]). Replaces the previous
 * single-color chart so the dashboard shows *which* models drove usage,
 * not just the magnitude.
 *
 * Pure inline SVG — no chart dependency, matches the rest of the page.
 */
function StackedDailyChart(props: {
  byDay: UsageByDay[];
  byDayByModel: UsageByDayAndModel[];
  byModel: UsageByModel[];
}) {
  const segmentsByDay = () => indexSegmentsByDay(props.byDayByModel);
  const colorByModel = () => buildModelColorMap(props.byModel);

  const width = 720;
  const height = 180;
  const padBottom = 22;
  const padTop = 8;
  const gap = 3;
  // Minimum visible segment height (px). Keeps tiny contributions
  // hoverable; the tooltip shows the real (unfloored) value.
  const minSegH = 0.5;

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
          aria-label="Daily token usage by model"
        >
          <For each={props.byDay}>
            {(day, i) => {
              const bw = barWidth();
              const x = i() * (bw + gap);
              const usableH = height - padBottom - padTop;
              const dayTotal = Math.max(1, day.totalTokens);
              const dayMap = segmentsByDay().get(day.day);
              // Within-day ordering: largest segment at the bottom of the
              // bar so the total stays anchored and small contributions
              // sit on top. Tie-break by model key for stable renders.
              const segments = dayMap
                ? [...dayMap.values()].sort((a, b) => {
                    if (b.totalTokens !== a.totalTokens) {
                      return b.totalTokens - a.totalTokens;
                    }
                    return `${a.providerId}/${a.modelId}`.localeCompare(
                      `${b.providerId}/${b.modelId}`,
                    );
                  })
                : [];

              // `cursorY` tracks the top edge of the next segment to draw
              // — we paint from the baseline upward.
              let cursorY = height - padBottom;
              const showLabel = i() % labelEvery() === 0;
              return (
                <>
                  <For each={segments}>
                    {(seg) => {
                      const modelKey = `${seg.providerId}/${seg.modelId}`;
                      const rawH = (seg.totalTokens / dayTotal) * usableH;
                      const h = Math.max(minSegH, rawH);
                      const y = cursorY - h;
                      cursorY = y;
                      const color =
                        colorByModel().get(modelKey) ?? FILL_OVERFLOW;
                      const pct = (
                        (seg.totalTokens / dayTotal) *
                        100
                      ).toFixed(1);
                      return (
                        <rect x={x} y={y} width={bw} height={h} class={color}>
                          <title>
                            {day.day} · {modelKey}:{' '}
                            {formatNumber(seg.totalTokens)} tokens ({pct}% of
                            day)
                          </title>
                        </rect>
                      );
                    }}
                  </For>
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
      {/* Legend — one row per model in rank order, color swatch + key +
          total tokens across the range. Wraps on narrow viewports. */}
      <Show when={props.byModel.length > 0}>
        <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-secondary">
          <For each={props.byModel}>
            {(row) => {
              const key = `${row.providerId}/${row.modelId}`;
              const color = colorByModel().get(key) ?? FILL_OVERFLOW;
              return (
                <li class="flex items-center gap-1.5">
                  <span
                    class={`inline-block w-3 h-3 rounded-sm ${color}`}
                    aria-hidden="true"
                  />
                  <span class="tabular-nums">{key}</span>
                  <span class="text-text-tertiary tabular-nums">
                    {formatNumber(row.totalTokens)}
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
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
              Tokens per day, by model
            </h2>
            <StackedDailyChart
              byDay={report()?.byDay ?? []}
              byDayByModel={report()?.byDayByModel ?? []}
              byModel={report()?.byModel ?? []}
            />
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
