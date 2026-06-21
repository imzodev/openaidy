/**
 * Gemini function-name mapping types
 *
 * Per project convention, types are exported from type files
 * and imported wherever needed. The `GeminiFunctionNameMap` is
 * built by the request mapper and consumed by the response
 * mapper to translate sanitized function names back to the
 * internal `server::tool` shape used by the dispatch layer.
 */

export type GeminiFunctionNameMap = ReadonlyMap<string, string>;
