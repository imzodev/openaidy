/**
 * Environment scrubbing for the exec sandbox.
 *
 * `exec_run` lets an agent run shell commands. Inheriting the server's full
 * `process.env` would hand every command our secrets (DB credentials, the JWT
 * secret, the credential master key, provider API keys, …). Instead we pass a
 * default-deny allowlist: only the baseline variables a shell and common
 * tooling need to function, never anything sensitive.
 */

/** Baseline, non-secret env vars a shell and common tools need to run. */
export const DEFAULT_EXEC_ENV_ALLOWLIST = [
  // POSIX shells / tooling
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TZ',
  'TERM',
  'TMPDIR',
  // Windows (cmd.exe and most tooling break without these)
  'SystemRoot',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
  'windir',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'OS',
  'USERNAME',
  'COMPUTERNAME',
];

/**
 * Build a scrubbed environment containing only allowlisted variables from
 * `source`. Matching is case-insensitive (Windows env var names are
 * case-insensitive). Pass `extraAllow` to permit additional names a specific
 * deployment legitimately needs.
 */
export function buildScrubbedEnv(
  source: NodeJS.ProcessEnv = process.env,
  extraAllow: string[] = [],
): NodeJS.ProcessEnv {
  const allow = new Set(
    [...DEFAULT_EXEC_ENV_ALLOWLIST, ...extraAllow].map((k) => k.toUpperCase()),
  );
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && allow.has(key.toUpperCase())) {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}
