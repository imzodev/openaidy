/**
 * Skill body sanitization
 *
 * Strips known prompt injection patterns from skill bodies before
 * they are appended to the system prompt.
 */

/**
 * Patterns that indicate an attempt to override system behavior.
 * These are replaced with [FILTERED] in the sanitized output.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // Prompt override attempts
  /ignore\s+(all\s+)?previous\s+(instruction|directive)s?/gi,
  /you\s+are\s+now/gi,
  /forget\s+(all\s+)?(previous|earlier)\s+(instruction|directive)s?/gi,
  /disregard\s+(all\s+)?(instruction|directive)s?/gi,
  /you\s+must\s+now/gi,
  /\bstrip\s+downstream\s+(instruction|directive)s?\b/gi,
  /<system_prompt>/gi,
  /\[SYSTEM_PROMPT\]/gi,
  // Code injection patterns (defense in depth — skill bodies should not contain code)
  /__import__/gi,
  /eval\s*\(/gi,
  /exec\s*\(/gi,
  /child_process/gi,
  /subprocess/gi,
  /os\.system/gi,
  /shell\s*=\s*true/gi,
  /pickle/gi,
  /base64/gi,
];

/**
 * Maximum allowed byte size for a skill body.
 * 50 KB is sufficient for detailed skill instructions while preventing DoS.
 */
export const MAX_BODY_SIZE = 50_000;

/**
 * Sanitize a skill body by replacing dangerous patterns with [FILTERED].
 * Returns the sanitized body string.
 */
export function sanitizeSkillBody(body: string): string {
  let sanitized = body;
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[FILTERED]');
  }
  return sanitized;
}

/**
 * Check if a skill body exceeds the maximum allowed size.
 * Returns true if the body is within limits.
 */
export function isBodySizeValid(body: string): boolean {
  return body.length <= MAX_BODY_SIZE;
}
