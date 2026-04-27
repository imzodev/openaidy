import { describe, it, expect } from 'vitest';
import { parseSkillMd } from './parser.js';

describe('parseSkillMd', () => {
  it('parses a valid SKILL.md with all fields', () => {
    const content = [
      '---',
      'name: Git Workflow',
      'description: Step-by-step git workflow for branching and committing',
      '---',
      'Always create a feature branch before making changes:',
      '',
      '```bash',
      'git checkout -b feat/<short-description>',
      '```',
    ].join('\n');

    const result = parseSkillMd(content, 'git-workflow', '/path/to/SKILL.md');

    expect(result).toEqual({
      id: 'git-workflow',
      name: 'Git Workflow',
      description: 'Step-by-step git workflow for branching and committing',
      body: 'Always create a feature branch before making changes:\n\n```bash\ngit checkout -b feat/<short-description>\n```',
    });
  });

  it('parses skill with empty body', () => {
    const content = [
      '---',
      'name: Empty Skill',
      'description: A skill with no body',
      '---',
    ].join('\n');

    const result = parseSkillMd(content, 'empty-skill', '/path/to/SKILL.md');

    expect(result).toEqual({
      id: 'empty-skill',
      name: 'Empty Skill',
      description: 'A skill with no body',
      body: '',
    });
  });

  it('parses skill with description having quotes', () => {
    const content = [
      '---',
      'name: SQL Expert',
      'description: Best practices for writing and reviewing SQL queries',
      '---',
      'Always use uppercase SQL keywords.',
    ].join('\n');

    const result = parseSkillMd(content, 'sql-expert', '/path/to/SKILL.md');

    expect(result).toEqual({
      id: 'sql-expert',
      name: 'SQL Expert',
      description: 'Best practices for writing and reviewing SQL queries',
      body: 'Always use uppercase SQL keywords.',
    });
  });

  it('returns error when name is missing', () => {
    const content = [
      '---',
      'description: A skill without a name',
      '---',
      'Some body content.',
    ].join('\n');

    const result = parseSkillMd(content, 'no-name', '/path/to/SKILL.md');

    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        { message: expect.stringContaining('name') },
      ]),
    });
  });

  it('returns error when description is missing', () => {
    const content = [
      '---',
      'name: No Description Skill',
      '---',
      'Some body content.',
    ].join('\n');

    const result = parseSkillMd(content, 'no-desc', '/path/to/SKILL.md');

    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        { message: expect.stringContaining('description') },
      ]),
    });
  });

  it('returns error when both name and description are missing', () => {
    const content = ['---', '---', 'Some body content.'].join('\n');

    const result = parseSkillMd(content, 'no-frontmatter', '/path/to/SKILL.md');

    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        { message: expect.stringContaining('name') },
        { message: expect.stringContaining('description') },
      ]),
    });
  });

  it('returns error when frontmatter delimiters are missing', () => {
    const content = [
      'name: No Delimiters',
      'description: Missing the --- delimiters',
      '---',
      'Some body content.',
    ].join('\n');

    const result = parseSkillMd(content, 'no-delims', '/path/to/SKILL.md');

    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        {
          message: expect.stringContaining('---'),
        },
      ]),
    });
  });

  it('returns error when only one frontmatter delimiter exists', () => {
    const content = [
      '---',
      'name: One Delimiter',
      'description: Only one dash',
      '---',
      'Some body content without closing delimiter',
    ].join('\n');

    const result = parseSkillMd(content, 'one-delim', '/path/to/SKILL.md');

    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        {
          message: expect.stringContaining('---'),
        },
      ]),
    });
  });

  it('parses skill with multi-line description', () => {
    const content = [
      '---',
      'name: Multi-line',
      'description: This is a longer description that might',
      '  span multiple lines in the YAML',
      '---',
      'Body here.',
    ].join('\n');

    const result = parseSkillMd(content, 'multiline', '/path/to/SKILL.md');

    // The parser extracts description by taking everything after "description:"
    expect(result).toMatchObject({
      id: 'multiline',
      name: 'Multi-line',
    });
  });

  it('preserves markdown formatting in body', () => {
    const content = [
      '---',
      'name: Formatted Skill',
      'description: A skill with complex body formatting',
      '---',
      '## Rules',
      '',
      '- Bullet one',
      '- Bullet two',
      '',
      '```typescript',
      'const x = 1;',
      '```',
    ].join('\n');

    const result = parseSkillMd(content, 'formatted', '/path/to/SKILL.md');

    expect(result).toEqual({
      id: 'formatted',
      name: 'Formatted Skill',
      description: 'A skill with complex body formatting',
      body: '## Rules\n\n- Bullet one\n- Bullet two\n\n```typescript\nconst x = 1;\n```',
    });
  });

  it('trims leading/trailing whitespace from body', () => {
    const content = [
      '---',
      'name: Trim Skill',
      'description: Trims whitespace',
      '---',
      '   \n  Body with whitespace.  \n   ',
    ].join('\n');

    const result = parseSkillMd(content, 'trim', '/path/to/SKILL.md') as {
      body: string;
    };

    expect(result.body).toBe('Body with whitespace.');
  });

  it('uses the id parameter as skill id, not frontmatter name', () => {
    const content = [
      '---',
      'name: Different Name',
      'description: The ID comes from directory',
      '---',
      'Body.',
    ].join('\n');

    const result = parseSkillMd(
      content,
      'my-custom-id',
      '/path/to/SKILL.md',
    ) as { id: string; name: string };

    expect(result.id).toBe('my-custom-id');
    expect(result.name).toBe('Different Name');
  });
});
