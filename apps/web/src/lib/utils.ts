/**
 * Shared pure utility functions.
 * No framework dependencies — safe to import anywhere.
 */

/**
 * Groups an array of items by their `category` field into an ordered list.
 * Items whose category appears in `categoryOrder` are placed first (in that order);
 * remaining categories follow alphabetically.
 */
export function groupByCategory<T extends { category?: string }>(
  items: T[],
  defaultCategory: string,
  categoryOrder: string[],
): Array<{ category: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const cat = item.category ?? defaultCategory;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(item);
  }

  const ordered: Array<{ category: string; items: T[] }> = [];
  for (const cat of categoryOrder) {
    if (map.has(cat)) {
      ordered.push({ category: cat, items: map.get(cat)! });
      map.delete(cat);
    }
  }
  for (const [cat, its] of [...map.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    ordered.push({ category: cat, items: its });
  }

  return ordered;
}
