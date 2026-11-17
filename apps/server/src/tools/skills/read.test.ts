import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillRegistry } from '../../skills/index';
import { WorkspaceService } from '../../workspace/service';
import { AgentRegistry } from '../../agents/registry';
import { createSkillReadTool } from './read';

const CTX = { agentId: 'reader', sessionId: 's1' };

function skillMd(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;
}

describe('skill_read', () => {
  let root: string;
  let tool: ReturnType<typeof createSkillReadTool>;

  beforeEach(async () => {
    root = join(tmpdir(), `skill-read-test-${Date.now()}-${Math.random()}`);
    const globalDir = join(root, 'global');
    const workspaceBase = join(root, 'workspaces');

    await mkdir(join(globalDir, 'global-skill'), { recursive: true });
    await writeFile(
      join(globalDir, 'global-skill', 'SKILL.md'),
      skillMd('Global', 'Global instructions.'),
    );
    await writeFile(
      join(globalDir, 'global-skill', 'examples.md'),
      'Example A',
    );

    await mkdir(join(globalDir, 'shadowed'), { recursive: true });
    await writeFile(
      join(globalDir, 'shadowed', 'SKILL.md'),
      skillMd('Shadowed', 'Global version.'),
    );
    await mkdir(join(workspaceBase, CTX.agentId, 'skills', 'shadowed'), {
      recursive: true,
    });
    await writeFile(
      join(workspaceBase, CTX.agentId, 'skills', 'shadowed', 'SKILL.md'),
      skillMd('Shadowed', 'Workspace version.'),
    );

    const registry = createSkillRegistry({ skillsDir: globalDir });
    registry.load();
    const agents = new AgentRegistry({
      initialAgents: [
        {
          id: CTX.agentId,
          name: 'Reader',
          enabled: true,
          systemPrompt: 'x',
          model: 'openai/gpt-4o-mini',
          version: 1,
          skills: ['global-skill', 'shadowed'],
        },
      ],
    });
    tool = createSkillReadTool(
      registry,
      agents,
      new WorkspaceService({ baseDir: workspaceBase }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a global skill body and lists its companion files', async () => {
    const result = await tool.execute({ skill_id: 'global-skill' }, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('Global instructions.');
    expect(result.content).toContain('examples.md');
  });

  it('prefers the agent workspace copy of a skill', async () => {
    const result = await tool.execute({ skill_id: 'shadowed' }, CTX);
    expect(result.ok && result.content).toContain('Workspace version.');
  });

  it('reads a companion file', async () => {
    const result = await tool.execute(
      { skill_id: 'global-skill', file: 'examples.md' },
      CTX,
    );
    expect(result).toEqual({ ok: true, content: 'Example A' });
  });

  it('refuses skills not assigned to the agent', async () => {
    const result = await tool.execute({ skill_id: 'other' }, CTX);
    expect(result.ok).toBe(false);
  });

  it('refuses paths outside the skill folder', async () => {
    const result = await tool.execute(
      { skill_id: 'global-skill', file: '../shadowed/SKILL.md' },
      CTX,
    );
    expect(result.ok).toBe(false);
  });
});
