/**
 * Gemini function-name sanitization
 *
 * Gemini's `generateContent` API rejects function names containing
 * "more than one colon" (server-side validation, surfaced as
 * "Function name contains more than one colon"). MCP servers expose
 * their tools as `<server>::<tool>`, which is two colons.
 *
 * To stay compatible with MCP-style names we:
 *   - On the request side, replace `::` with `:` so the name has at
 *     most one colon and passes the API validation.
 *   - On the response side, look up the model's (sanitized) name
 *     in the per-request name map and return the original
 *     `server::tool` shape — that's what the dispatch layer keys on.
 *
 * The substitution is unambiguous because MCP tool names follow the
 * `<server>::<tool>` convention and tool names themselves are
 * expected to be alphanumeric (no internal colons).
 */

import type { GeminiFunctionNameMap } from './name-mapping.types';

/**
 * Replace `::` with `:` in a single function name. Returns the
 * input unchanged if it contains no `::` (the common case for
 * non-MCP, in-process tools).
 */
export function sanitizeGeminiFunctionName(name: string): string {
  if (!name.includes('::')) return name;
  return name.replace(/::/g, ':');
}

/**
 * Build a `sanitized -> original` lookup map for the tools being
 * sent to Gemini. The map is the inverse of the sanitization:
 * the model returns the sanitized name in its `functionCall`, and
 * the response mapper uses this map to recover the original.
 */
export function buildGeminiFunctionNameMap(
  originalNames: readonly string[],
): GeminiFunctionNameMap {
  const map = new Map<string, string>();
  for (const original of originalNames) {
    const sanitized = sanitizeGeminiFunctionName(original);
    if (sanitized !== original) {
      map.set(sanitized, original);
    }
  }
  return map;
}

/**
 * Reverse-lookup a sanitized Gemini function name against the map
 * produced at request time. Falls back to the input name when no
 * mapping exists (e.g. non-MCP tools, or a name that didn't need
 * sanitization). Returns `undefined` only if `name` is empty.
 */
export function restoreGeminiFunctionName(
  sanitizedName: string,
  nameMap: GeminiFunctionNameMap,
): string {
  if (!sanitizedName) return sanitizedName;
  return nameMap.get(sanitizedName) ?? sanitizedName;
}
