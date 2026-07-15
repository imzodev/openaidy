/**
 * Usage aggregation helpers.
 *
 * Pure functions that roll up per-run usage rows into totals and
 * breakdowns by day, provider, and model. Grouping is done here (rather
 * than in SQL) so the queries stay portable across SQLite and Postgres.
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

export type UsageReport = {
  totals: UsageTotals;
  byDay: UsageByDay[];
  byProvider: UsageByProvider[];
  byModel: UsageByModel[];
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
 * Roll up usage rows into overall totals plus day/provider/model
 * breakdowns. Breakdown arrays are sorted: days ascending, provider/model
 * by descending total tokens.
 */
export function aggregateUsage(rows: UsageRunRow[]): UsageReport {
  const totals = emptyTotals();
  const byDay = new Map<string, UsageByDay>();
  const byProvider = new Map<string, UsageByProvider>();
  const byModel = new Map<string, UsageByModel>();

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
  };
}
