/**
 * Skills parser
 *
 * Parses a SKILL.md file content into a structured SkillDefinition.
 * Uses simple line scanning instead of a full YAML parser since only
 * 'name' and 'description' keys are needed.
 */

import { isBodySizeValid } from './sanitize.js';

export type SkillDefinition = {
  /** Directory name — the canonical skill ID */
  id: string;
  /** From frontmatter 'name' field */
  name: string;
  /** From frontmatter 'description' field */
  description: string;
  /** From frontmatter 'version' field — used for seeding/update checks */
  version?: string;
  /** Everything after the closing --- delimiter, trimmed */
  body: string;
};

export type SkillParseError = {
  filePath: string;
  errors: Array<{ message: string }>;
};

/**
 * Parse a SKILL.md content string into a SkillDefinition.
 *
 * Algorithm:
 * 1. Split content on the first two '---' lines
 * 2. Section 0 (before first '---'): ignored
 * 3. Section 1 (between '---' lines): YAML frontmatter — extract name and description by line scan
 * 4. Section 2 (after closing '---'): the body, trimmed
 * 5. Return SkillParseError if name or description is missing
 */
export function parseSkillMd(
  content: string,
  id: string,
  filePath: string,
): SkillDefinition | SkillParseError {
  const errors: Array<{ message: string }> = [];

  const lines = content.split('\n');

  // Find first two '---' lines
  const dashesIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim() === '---') {
      dashesIndices.push(i);
      if (dashesIndices.length === 2) break;
    }
  }

  // Need at least 2 '---' delimiters
  if (dashesIndices.length < 2) {
    return {
      filePath,
      errors: [
        {
          message:
            'Invalid SKILL.md format: missing frontmatter delimiters (---). Expected --- delimiters around YAML frontmatter.',
        },
      ],
    };
  }

  const firstDash = dashesIndices[0]!;
  const secondDash = dashesIndices[1]!;
  const frontmatterStart = firstDash + 1;
  const frontmatterEnd = secondDash - 1;

  // Extract name, description, and version from frontmatter lines
  let name: string | undefined;
  let description: string | undefined;
  let version: string | undefined;

  for (let i = frontmatterStart; i <= frontmatterEnd; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith('name:')) {
      name = line.substring('name:'.length).trim();
    } else if (line.startsWith('description:')) {
      description = line.substring('description:'.length).trim();
    } else if (line.startsWith('version:')) {
      version = line.substring('version:'.length).trim();
    }
  }

  if (!name) {
    errors.push({ message: 'Missing required frontmatter field: name' });
  }
  if (!description) {
    errors.push({
      message: 'Missing required frontmatter field: description',
    });
  }

  if (errors.length > 0) {
    return { filePath, errors };
  }

  // Body is everything after the closing ---
  const bodyLines = lines.slice(secondDash + 1);
  const body = bodyLines.join('\n').trim();

  if (!isBodySizeValid(body)) {
    errors.push({
      message: `Skill body exceeds maximum size of 50,000 characters`,
    });
  }

  if (errors.length > 0) {
    return { filePath, errors };
  }

  return {
    id,
    name: name!,
    description: description!,
    ...(version !== undefined ? { version } : {}),
    body,
  };
}
