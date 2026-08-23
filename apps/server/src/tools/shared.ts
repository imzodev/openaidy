/**
 * Small helpers shared by builtin tools.
 *
 * Every tool has the same three bits of boilerplate: pulling its service out
 * of a lazy getter (because the service may be absent when the DB is
 * disabled), validating a string argument, and wrapping a thrown error into
 * the `{ ok: false, error }` shape the tool contract requires. Keep these
 * helpers narrow and JSON-Schema-style: they accept `unknown` because the
 * tool receives `Record<string, unknown>` from the LLM tool-call dispatcher.
 */

export type ToolFailure = { ok: false; error: string };

/**
 * Resolve a service via a lazy getter and return the uniform "not available"
 * failure when it is missing. Callers use this as the first line of `execute`
 * so the rest of the body can assume the service is present.
 */
export function requireService<T>(
  getter: () => T | undefined,
  serviceName: string,
): { ok: true; service: T } | ToolFailure {
  const service = getter();
  if (!service) {
    return {
      ok: false,
      error: `${serviceName} is not available (database might be disabled).`,
    };
  }
  return { ok: true, service };
}

/**
 * Validate a required string argument. Returns `null` when the value is OK
 * (a non-empty string) and an error message otherwise. Callers do
 * `if (err) return { ok: false, error: err }`.
 */
export function requireString(
  value: unknown,
  fieldName: string,
): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return `${fieldName} is required and must be a non-empty string`;
  }
  return null;
}

/**
 * Validate an optional string argument. `undefined` means "not provided"
 * (allowed). A provided value must be a non-empty string. Returning the
 * trimmed value would be convenient but couples the helper to "this field
 * will be used as-is downstream"; callers can trim themselves.
 */
export function optionalString(
  value: unknown,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    return `${fieldName} must be a non-empty string when provided`;
  }
  return null;
}

/**
 * Wrap an unknown thrown value into the `{ ok: false, error }` shape the
 * tool contract requires. Prefer this over hand-rolled `catch` blocks so
 * the error format stays uniform across tools.
 */
export function formatToolError(prefix: string, err: unknown): ToolFailure {
  return {
    ok: false,
    error: `${prefix}: ${err instanceof Error ? err.message : String(err)}`,
  };
}
