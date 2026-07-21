/**
 * Usage aggregation helpers.
 *
 * Pure functions that roll up per-run usage rows into totals and
 * breakdowns by day, provider, model, and day×model. Grouping is done
 * here (rather than in SQL) so the queries stay portable across SQLite
 * and Postgres.
 */

import type { UsageRunRow } from '@openaidy/db';

export type UsageTotals = {
  runCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Sum of known run costs (USD). */
  cost: number;
  /** True when at least one run contributed a known cost. */
  hasCost: boolean;
};

export type UsageByDay = UsageTotals & { day: string };
export type UsageByProvider = UsageTotals & { providerId: string };
export type UsageByModel = UsageTotals & {
  providerId: string;
  modelId: string;
};
/**
 * Per-day × per-model rollup. Powers the stacked-bar usage chart on the
 * dashboard, which needs to know exactly how much each model contributed
 * on each day (not just the per-day total or the per-model total).
 */
export type UsageByDayAndModel = UsageTotals & {
  day: string;
  providerId: string;
  modelId: string;
};

export type UsageReport = {
  totals: UsageTotals;
  byDay: UsageByDay[];
  byProvider: UsageByProvider[];
  byModel: UsageByModel[];
  /** Per-day × per-model breakdown. Empty when no rows. */
  byDayByModel: UsageByDayAndModel[];
};

function emptyTotals(): UsageTotals {
  return {
    runCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cost: 0,
    hasCost: false,
  };
}

function addRow(target: UsageTotals, row: UsageRunRow): void {
  target.runCount += 1;
  target.promptTokens += row.promptTokens;
  target.completionTokens += row.completionTokens;
  target.totalTokens += row.totalTokens;
  target.cacheReadTokens += row.cacheReadTokens;
  target.cacheCreationTokens += row.cacheCreationTokens;
  if (row.cost !== null) {
    target.cost += row.cost;
    target.hasCost = true;
  }
}

/** The UTC calendar day (YYYY-MM-DD) an ISO timestamp falls on. */
export function dayOf(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Roll up usage rows into overall totals plus day/provider/model/day×model
 * breakdowns. Breakdown arrays are sorted: days ascending; provider/model
 * by descending total tokens; byDayByModel by day ascending (within-day
 * ordering is unspecified — renderers sort segments per bar).
 */
export function aggregateUsage(rows: UsageRunRow[]): UsageReport {
  const totals = emptyTotals();
  const byDay = new Map<string, UsageByDay>();
  const byProvider = new Map<string, UsageByProvider>();
  const byModel = new Map<string, UsageByModel>();
  // Nested map keeps lookups O(1) while we still process rows in a single
  // pass. Outer key = day, inner key = `${providerId}/${modelId}`.
  const byDayByModel = new Map<string, Map<string, UsageByDayAndModel>>();

  for (const row of rows) {
    addRow(totals, row);

    const day = dayOf(row.createdAt);
    let dayEntry = byDay.get(day);
    if (!dayEntry) {
      dayEntry = { ...emptyTotals(), day };
      byDay.set(day, dayEntry);
    }
    addRow(dayEntry, row);

    let providerEntry = byProvider.get(row.providerId);
    if (!providerEntry) {
      providerEntry = { ...emptyTotals(), providerId: row.providerId };
      byProvider.set(row.providerId, providerEntry);
    }
    addRow(providerEntry, row);

    const modelKey = `${row.providerId}/${row.modelId}`;
    let modelEntry = byModel.get(modelKey);
    if (!modelEntry) {
      modelEntry = {
        ...emptyTotals(),
        providerId: row.providerId,
        modelId: row.modelId,
      };
      byModel.set(modelKey, modelEntry);
    }
    addRow(modelEntry, row);

    let dayMap = byDayByModel.get(day);
    if (!dayMap) {
      dayMap = new Map();
      byDayByModel.set(day, dayMap);
    }
    let dayModelEntry = dayMap.get(modelKey);
    if (!dayModelEntry) {
      dayModelEntry = {
        ...emptyTotals(),
        day,
        providerId: row.providerId,
        modelId: row.modelId,
      };
      dayMap.set(modelKey, dayModelEntry);
    }
    addRow(dayModelEntry, row);
  }

  // Flatten the nested day×model map. Sort by day ascending; within-day
  // order doesn't matter for the chart (the renderer sorts segments by
  // totalTokens desc per bar), but a stable day-first order keeps the
  // payload diffable across requests and easier to scan in logs.
  const byDayByModelList: UsageByDayAndModel[] = [];
  const sortedDays = [...byDayByModel.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  for (const day of sortedDays) {
    const dayMap = byDayByModel.get(day);
    if (!dayMap) continue;
    for (const entry of dayMap.values()) {
      byDayByModelList.push(entry);
    }
  }

  return {
    totals,
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProvider: [...byProvider.values()].sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
    byModel: [...byModel.values()].sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
    byDayByModel: byDayByModelList,
  };
}
