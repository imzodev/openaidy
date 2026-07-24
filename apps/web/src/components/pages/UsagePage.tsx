import { createResource, createSignal, For, Show } from 'solid-js';
import { Layout } from './Layout';
import { getUsage } from '../../lib/api';
import type {
  UsageByDay,
  UsageByDayAndModel,
  UsageByModel,
  UsageReport,
} from '../../lib/types';
import {
  formatNumber,
  formatCost,
  formatTokensCompact,
} from '../../lib/usage-format';

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
 * Each entry carries both halves of the color: `fill` for SVG bar
 * segments and `bg` for HTML swatches (legend dots, table dots) — a
 * `fill-*` class paints nothing on a non-SVG element, so the two
 * contexts need separate classes built from the same hue.
 */
type ModelColor = { fill: string; bg: string };

const CHART_PALETTE: readonly ModelColor[] = [
  { fill: 'fill-blue-500', bg: 'bg-blue-500' },
  { fill: 'fill-emerald-500', bg: 'bg-emerald-500' },
  { fill: 'fill-amber-500', bg: 'bg-amber-500' },
  { fill: 'fill-violet-500', bg: 'bg-violet-500' },
  { fill: 'fill-rose-500', bg: 'bg-rose-500' },
  { fill: 'fill-cyan-500', bg: 'bg-cyan-500' },
  { fill: 'fill-orange-500', bg: 'bg-orange-500' },
  { fill: 'fill-lime-500', bg: 'bg-lime-500' },
  { fill: 'fill-pink-500', bg: 'bg-pink-500' },
  { fill: 'fill-indigo-500', bg: 'bg-indigo-500' },
];

const COLOR_OVERFLOW: ModelColor = {
  fill: 'fill-gray-300 dark:fill-gray-600',
  bg: 'bg-gray-300 dark:bg-gray-600',
};

/** Stable model-key → color assignment, sorted by totalTokens desc. */
function buildModelColorMap(byModel: UsageByModel[]): Map<string, ModelColor> {
  const map = new Map<string, ModelColor>();
  byModel.forEach((row, i) => {
    const key = `${row.providerId}/${row.modelId}`;
    map.set(key, CHART_PALETTE[i % CHART_PALETTE.length] ?? COLOR_OVERFLOW);
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

/** Tooltip payload for the chart's floating (non-native) tooltip. */
type ChartTooltip =
  | {
      kind: 'segment';
      left: number;
      top: number;
      day: string;
      modelKey: string;
      tokens: number;
      pct: string;
      bg: string;
    }
  | { kind: 'day'; left: number; top: number; day: string; tokens: number };

/**
 * Path for a bar silhouette with only the top corners rounded. Used as a
 * clip path so the stacked segments stay crisp rectangles while the bar
 * as a whole reads as one rounded column.
 */
function roundedTopPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

/**
 * Stacked daily token-usage chart. Each bar = one day; bar height = that
 * day's total tokens, scaled to the largest day in the range so magnitude
 * is visible at a glance; bar segments = per-model contributions, colored
 * stably by rank (top model = palette[0]).
 *
 * Interactions: hovering a column highlights it and dims the rest;
 * hovering a legend item highlights that model's segments across every
 * bar — the fast way to learn which color is which model. Values surface
 * in a cursor-following tooltip (native <title> is too slow for a dense
 * chart).
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

  const [tooltip, setTooltip] = createSignal<ChartTooltip | null>(null);
  const [hoverDay, setHoverDay] = createSignal<string | null>(null);
  const [hoverModel, setHoverModel] = createSignal<string | null>(null);
  let containerRef: HTMLDivElement | undefined;

  const width = 720;
  const height = 200;
  const padBottom = 22;
  const padTop = 10;
  // Room on the left for the compact gridline labels.
  const padLeft = 34;
  const gap = 4;
  const barRadius = 3;
  // Bars for days with any usage never drop below this height, so a small
  // day still reads as present rather than rounding away to nothing.
  const minBarH = 2;

  const usableH = height - padBottom - padTop;
  const chartW = width - padLeft;

  const maxDayTotal = () =>
    Math.max(1, ...props.byDay.map((d) => d.totalTokens));

  const barWidth = () => {
    const n = props.byDay.length || 1;
    return Math.max(2, (chartW - gap * (n - 1)) / n);
  };

  // Show at most ~8 date labels to avoid collisions.
  const labelEvery = () => Math.max(1, Math.ceil(props.byDay.length / 8));

  /** Cursor position relative to the chart container, clamped so the
   *  tooltip never overflows the card edges. */
  const pointFromEvent = (e: MouseEvent): { left: number; top: number } => {
    const rect = containerRef?.getBoundingClientRect();
    if (!rect) return { left: 0, top: 0 };
    return {
      left: Math.min(Math.max(e.clientX - rect.left, 72), rect.width - 72),
      top: e.clientY - rect.top,
    };
  };

  /** Opacity of one segment given the current hover state: the hovered
   *  day and hovered model stay solid, everything else fades back. */
  const segmentOpacity = (day: string, modelKey: string): number => {
    if (hoverModel() !== null) return hoverModel() === modelKey ? 1 : 0.2;
    if (hoverDay() !== null) return hoverDay() === day ? 1 : 0.35;
    return 1;
  };

  return (
    <Show
      when={props.byDay.length > 0}
      fallback={
        <div class="flex items-center justify-center h-44 text-text-tertiary text-sm">
          No usage in this range
        </div>
      }
    >
      <div class="relative" ref={containerRef}>
        <div class="overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            class="w-full min-w-[480px] select-none"
            role="img"
            aria-label="Daily token usage by model"
          >
            {/* Horizontal gridlines at 50% / 100% of the largest day +
                the baseline the bars sit on. */}
            <For each={[0.5, 1]}>
              {(f) => {
                const y = padTop + usableH * (1 - f);
                return (
                  <>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width}
                      y2={y}
                      class="stroke-gray-200 dark:stroke-gray-700"
                      stroke-width="1"
                      stroke-dasharray={f === 1 ? undefined : '3 3'}
                    />
                    <text
                      x={padLeft - 5}
                      y={y + 3}
                      text-anchor="end"
                      class="fill-text-tertiary pointer-events-none"
                      style={{ 'font-size': '8px' }}
                    >
                      {formatTokensCompact(Math.round(maxDayTotal() * f))}
                    </text>
                  </>
                );
              }}
            </For>
            <line
              x1={padLeft}
              y1={height - padBottom}
              x2={width}
              y2={height - padBottom}
              class="stroke-gray-300 dark:stroke-gray-600"
              stroke-width="1"
            />

            <For each={props.byDay}>
              {(day, i) => {
                const bw = barWidth();
                const x = padLeft + i() * (bw + gap);
                const dayTotal = Math.max(1, day.totalTokens);
                const barH =
                  day.totalTokens > 0
                    ? Math.max(
                        minBarH,
                        (day.totalTokens / maxDayTotal()) * usableH,
                      )
                    : 0;
                const barTop = height - padBottom - barH;
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
                  <g
                    onMouseOver={() => setHoverDay(day.day)}
                    onMouseLeave={() => {
                      setHoverDay(null);
                      setTooltip(null);
                    }}
                  >
                    {/* Column highlight, shown while the day is hovered.
                        Painted first so it sits behind the bar. */}
                    <rect
                      x={x - gap / 2}
                      y={padTop}
                      width={bw + gap}
                      height={usableH}
                      rx={4}
                      class="fill-gray-300 dark:fill-gray-600"
                      style={{
                        opacity: hoverDay() === day.day ? 0.18 : 0,
                        transition: 'opacity 120ms',
                      }}
                      onMouseMove={(e) =>
                        setTooltip({
                          kind: 'day',
                          ...pointFromEvent(e),
                          day: day.day,
                          tokens: day.totalTokens,
                        })
                      }
                    />
                    {/* Segments, clipped to the rounded-top silhouette. */}
                    <clipPath id={`usage-bar-clip-${i()}`}>
                      <path
                        d={roundedTopPath(x, barTop, bw, barH, barRadius)}
                      />
                    </clipPath>
                    <g clip-path={`url(#usage-bar-clip-${i()})`}>
                      <For each={segments}>
                        {(seg) => {
                          const modelKey = `${seg.providerId}/${seg.modelId}`;
                          // Segments split the bar proportionally; the
                          // bar itself carries the absolute scale, so the
                          // stack always fills the rounded silhouette.
                          const h = (seg.totalTokens / dayTotal) * barH;
                          const y = cursorY - h;
                          cursorY = y;
                          const color =
                            colorByModel().get(modelKey) ?? COLOR_OVERFLOW;
                          const pct = (
                            (seg.totalTokens / dayTotal) *
                            100
                          ).toFixed(1);
                          return (
                            <rect
                              x={x}
                              y={y}
                              width={bw}
                              height={h}
                              class={color.fill}
                              style={{
                                opacity: segmentOpacity(day.day, modelKey),
                                transition: 'opacity 120ms',
                              }}
                              onMouseMove={(e) =>
                                setTooltip({
                                  kind: 'segment',
                                  ...pointFromEvent(e),
                                  day: day.day,
                                  modelKey,
                                  tokens: seg.totalTokens,
                                  pct,
                                  bg: color.bg,
                                })
                              }
                            />
                          );
                        }}
                      </For>
                    </g>
                    <Show when={showLabel}>
                      <text
                        x={x + bw / 2}
                        y={height - 6}
                        text-anchor="middle"
                        class="fill-text-tertiary pointer-events-none"
                        style={{ 'font-size': '9px' }}
                      >
                        {day.day.slice(5)}
                      </text>
                    </Show>
                  </g>
                );
              }}
            </For>
          </svg>
        </div>

        {/* Floating tooltip — follows the cursor, never captures it. */}
        <Show when={tooltip()}>
          {(tip) => {
            // Narrowed once locally so both variants stay type-safe.
            const body = () => {
              const t = tip();
              if (t.kind === 'day') {
                return (
                  <>
                    <div class="font-medium text-text-primary">{t.day}</div>
                    <div class="mt-0.5 text-text-secondary tabular-nums">
                      {formatNumber(t.tokens)} tokens
                    </div>
                  </>
                );
              }
              return (
                <>
                  <div class="flex items-center gap-1.5 text-text-secondary">
                    <span class={`inline-block w-2 h-2 rounded-full ${t.bg}`} />
                    {t.modelKey}
                  </div>
                  <div class="mt-0.5 font-medium text-text-primary tabular-nums">
                    {formatNumber(t.tokens)} tokens{' '}
                    <span class="font-normal text-text-tertiary">
                      ({t.pct}% of day)
                    </span>
                  </div>
                  <div class="text-text-tertiary">{t.day}</div>
                </>
              );
            };
            return (
              <div
                aria-hidden="true"
                class="absolute z-10 pointer-events-none rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
                style={{
                  left: `${tip().left}px`,
                  top: `${tip().top}px`,
                  transform: 'translate(-50%, calc(-100% - 10px))',
                }}
              >
                {body()}
              </div>
            );
          }}
        </Show>
      </div>

      {/* Legend — one item per model in rank order: color dot + key +
          total tokens across the range. Hovering an item highlights that
          model's segments in every bar above. Wraps on narrow viewports. */}
      <Show when={props.byModel.length > 0}>
        <ul class="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-xs">
          <For each={props.byModel}>
            {(row) => {
              const key = `${row.providerId}/${row.modelId}`;
              const color = colorByModel().get(key) ?? COLOR_OVERFLOW;
              return (
                <li>
                  <button
                    type="button"
                    class={`flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors ${
                      hoverModel() === key
                        ? 'bg-gray-100 dark:bg-gray-700/60 text-text-primary'
                        : 'text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700/60'
                    }`}
                    onMouseEnter={() => setHoverModel(key)}
                    onMouseLeave={() => setHoverModel(null)}
                    onFocus={() => setHoverModel(key)}
                    onBlur={() => setHoverModel(null)}
                  >
                    <span
                      class={`inline-block w-2.5 h-2.5 rounded-full ${color.bg}`}
                      aria-hidden="true"
                    />
                    <span class="tabular-nums">{key}</span>
                    <span class="text-text-tertiary tabular-nums">
                      {formatNumber(row.totalTokens)}
                    </span>
                  </button>
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

  // Same model→color assignment the chart uses, so the dots in the table
  // below match the bar segments and legend swatches exactly.
  const colorByModel = () => buildModelColorMap(report()?.byModel ?? []);

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
                      {(row) => {
                        const color =
                          colorByModel().get(
                            `${row.providerId}/${row.modelId}`,
                          ) ?? COLOR_OVERFLOW;
                        return (
                          <tr class="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                            <td class="px-4 py-2 text-text-secondary">
                              {row.providerId}
                            </td>
                            <td class="px-4 py-2 text-text-primary">
                              <span class="inline-flex items-center gap-2">
                                <span
                                  class={`inline-block w-2.5 h-2.5 rounded-full ${color.bg}`}
                                  aria-hidden="true"
                                />
                                {row.modelId}
                              </span>
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
                        );
                      }}
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
