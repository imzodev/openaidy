/**
 * Shared helpers for the addon_create / addon_update tools.
 *
 * These are extracted here so both tools apply IDENTICAL scaffolding rules.
 * The most important one is Tailwind CDN auto-injection: it must run on every
 * write of app/index.html — on create AND on update. When only create injected
 * it, an update that overwrote index.html silently stripped the Tailwind
 * <script> tag (the agent never authors it), so every utility class stopped
 * applying and the addon's styling broke on the first edit.
 */

// ── ID validation ──────────────────────────────────────────────────────────

/** Addon ids are lowercase alphanumeric with hyphens, not starting with a hyphen. */
export function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

// ── Relative path safety ─────────────────────────────────────────────────────

/** Returns an error string if the path is unsafe (absolute or has `.`/`..`), otherwise null. */
export function relativePathError(filePath: string): string | null {
  const parts = filePath.split('/');
  if (parts.some((p) => p === '..' || p === '.') || filePath.startsWith('/')) {
    return `File path "${filePath}" must be relative with no ".." segments`;
  }
  return null;
}

// ── Tailwind CDN auto-injection ──────────────────────────────────────────────
//
// Every addon gets Tailwind CSS for free — the agent should never have to
// remember to add it. We inject the plain (unversioned) Play CDN script,
// which always serves the latest Tailwind v3; a specific release can be
// pinned later by appending "/<version>" to the URL, once that path format
// is verified against the currently-shipped version (not done here, since it
// isn't checkable without network access at authoring time, and a wrong pin
// would silently 404 every addon's styling).
export const TAILWIND_CDN_URL = 'https://cdn.tailwindcss.com';
export const TAILWIND_CDN_HOST = 'cdn.tailwindcss.com';
const SDK_SCRIPT_TAG = '<script src="/sdk/openaidy-sdk.js">';

/**
 * Inject the Tailwind CDN <script> tag into an addon's index.html, right
 * before the (already-validated) SDK script tag. Idempotent — a no-op if the
 * tag (by host) is already present, so it is safe to run on both create and
 * every subsequent update.
 */
export function injectTailwindCdn(html: string): string {
  if (html.includes(TAILWIND_CDN_HOST)) return html;
  return html.replace(
    SDK_SCRIPT_TAG,
    `<script src="${TAILWIND_CDN_URL}"></script>\n  ${SDK_SCRIPT_TAG}`,
  );
}

// ── SDK entry-script validation ──────────────────────────────────────────────

/**
 * Validate that an addon's app/index.html loads the SDK statically and before
 * its own entry script. Returns an error string, or null when valid.
 */
export function validateEntryScripts(html: string): string | null {
  if (!html.includes('<script src="index.js">')) {
    return 'app/index.html must contain <script src="index.js"></script> before </body>';
  }
  if (!html.includes('<script src="/sdk/openaidy-sdk.js">')) {
    return 'app/index.html must load the SDK statically: <script src="/sdk/openaidy-sdk.js"></script> must appear before <script src="index.js">';
  }
  if (
    html.indexOf('<script src="/sdk/openaidy-sdk.js">') >
    html.indexOf('<script src="index.js">')
  ) {
    return '<script src="/sdk/openaidy-sdk.js"> must appear before <script src="index.js"> in app/index.html';
  }
  return null;
}

// ── External fetch() host extraction ─────────────────────────────────────────

/**
 * Scan addon source for fetch() calls to absolute http(s) URLs and return the
 * unique set of external hostnames referenced. Callers compare this against the
 * addon's declared externalDomains to catch CSP-blocked requests before write.
 */
export function extractExternalFetchHosts(content: string): string[] {
  const matches = content.match(/fetch\(\s*['"`](https?:\/\/[^'"`\s]+)/g);
  if (!matches) return [];
  const hosts = matches
    .map((m) => {
      const url = m.replace(/fetch\(\s*['"`]/, '');
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    })
    .filter((h): h is string => h !== null);
  return [...new Set(hosts)];
}
