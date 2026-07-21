/**
 * Tiny inline fuzzy scorer.
 *
 * Designed for the command palette where:
 * - The total corpus is small (~hundreds of commands at most)
 * - We want responsive per-keystroke scoring
 * - Substring, char-order and initials matches all feel natural
 *
 * Returns a numeric score, or -Infinity when there is no match. Higher is
 * better. The score favours:
 *  - exact substring matches (case-insensitive)
 *  - matches at word boundaries / start of words
 *  - matches in the same order as the typed characters (char-order)
 *  - "initials" matches (e.g. "gc" -> "Go to Chat")
 */

const NO_MATCH = -Infinity;

function normalise(s: string): string {
  return s.toLowerCase();
}

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  return prev === ' ' || prev === '-' || prev === '_' || prev === '.';
}

/**
 * Compute the initials of a label by taking the first letter of each
 * whitespace-separated token. Used for "gc" -> "Go to Chat" style matches.
 */
function initials(text: string): string {
  const parts = text
    .toLowerCase()
    .split(/[\s\-_./]+/g)
    .filter(Boolean);
  return parts.map((p) => p[0] ?? '').join('');
}

/**
 * Score a single candidate against a query. Returns a number (higher is
 * better) or -Infinity if the candidate does not match.
 */
export function scoreCandidate(query: string, label: string): number {
  const q = normalise(query.trim());
  if (q === '') return 0;

  const haystack = normalise(label);

  // Exact substring match: strongest signal.
  const exactIdx = haystack.indexOf(q);
  if (exactIdx !== -1) {
    return 1000 - exactIdx + (isWordBoundary(haystack, exactIdx) ? 50 : 0);
  }

  // Initials match: "gc" -> "Go to Chat".
  const init = initials(label);
  if (init.startsWith(q)) {
    return 600 - (init.length - q.length);
  }
  if (init.includes(q)) {
    return 400;
  }

  // Char-order match: every query character appears in order in the label.
  let h = 0;
  let bonus = 0;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    const idx = haystack.indexOf(ch, h);
    if (idx === -1) return NO_MATCH;
    if (isWordBoundary(haystack, idx)) bonus += 10;
    h = idx + 1;
  }
  // Prefer shorter labels when the char-order match ties.
  return 200 + bonus - (haystack.length - q.length) * 2;
}

/**
 * Filter and rank a list of items by `query`. Items are not mutated; the
 * returned list is a new array sorted by descending score.
 */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): T[] {
  const scored = items
    .map((item) => ({ item, score: scoreCandidate(query, getText(item)) }))
    .filter((entry) => entry.score > NO_MATCH);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}
