/**
 * Shared formatting helpers for token-usage / cost display, used by the usage
 * dashboard and the per-session usage on session cards so numbers read the
 * same everywhere.
 */

/** Full grouped integer, e.g. 12345 → "12,345". */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Cost in USD. `hasCost` is false when no run had known pricing, in which
 * case we show an em-dash rather than a misleading "$0.00". Small sub-dollar
 * amounts get 4 digits since cents aren't precise enough.
 */
export function formatCost(cost: number, hasCost: boolean): string {
  if (!hasCost) return '—';
  const digits = cost > 0 && cost < 1 ? 4 : 2;
  return `$${cost.toFixed(digits)}`;
}

/**
 * Compact token count for tight spots like session cards, e.g. 1500 → "1.5K",
 * 2_300_000 → "2.3M". Values under 1000 are shown as-is.
 */
export function formatTokensCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  const m = n / 1_000_000;
  return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
}
