import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  AgentPersonalityService,
  createAgentPersonalityService,
  isDefaultContent,
  PERSONALITY_FILES,
} from './personality-service';

describe('AgentPersonalityService', () => {
  let tempDir: string;
  let service: AgentPersonalityService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-personality-'));
    service = createAgentPersonalityService({ workspaceBaseDir: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scaffold', () => {
    it('creates all four personality files for a new agent', async () => {
      await service.scaffold('my-agent');

      for (const meta of PERSONALITY_FILES) {
        const filePath = path.join(tempDir, 'my-agent', meta.filename);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it('creates the agent workspace directory if it does not exist', async () => {
      await service.scaffold('new-agent');
      expect(fs.existsSync(path.join(tempDir, 'new-agent'))).toBe(true);
    });

    it('does not overwrite existing files', async () => {
      const agentDir = path.join(tempDir, 'existing-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      const agentMdPath = path.join(agentDir, 'AGENT.md');
      fs.writeFileSync(agentMdPath, 'custom content', 'utf-8');

      await service.scaffold('existing-agent');

      expect(fs.readFileSync(agentMdPath, 'utf-8')).toBe('custom content');
    });
  });

  describe('readFile', () => {
    it('returns default content with exists=false when file is missing', async () => {
      const result = await service.readFile('no-agent', 'AGENT');
      expect(result.id).toBe('AGENT');
      expect(result.exists).toBe(false);
      expect(result.content).toBeTruthy();
    });

    it('returns file content with exists=true when file is present', async () => {
      await service.scaffold('read-agent');
      const agentMdPath = path.join(tempDir, 'read-agent', 'AGENT.md');
      fs.writeFileSync(agentMdPath, 'I am the agent.', 'utf-8');

      const result = await service.readFile('read-agent', 'AGENT');
      expect(result.id).toBe('AGENT');
      expect(result.exists).toBe(true);
      expect(result.content).toBe('I am the agent.');
    });
  });

  describe('writeFile', () => {
    it('creates the file and directory if they do not exist', async () => {
      await service.writeFile('write-agent', 'RULES', 'Never lie.');

      const filePath = path.join(tempDir, 'write-agent', 'RULES.md');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Never lie.');
    });

    it('overwrites an existing file', async () => {
      await service.scaffold('overwrite-agent');
      await service.writeFile(
        'overwrite-agent',
        'MISSION',
        'Build great things.',
      );
      await service.writeFile(
        'overwrite-agent',
        'MISSION',
        'Build even better things.',
      );

      const result = await service.readFile('overwrite-agent', 'MISSION');
      expect(result.content).toBe('Build even better things.');
    });
  });

  describe('deleteWorkspace', () => {
    it('removes the entire workspace directory for an agent', async () => {
      await service.scaffold('to-delete');
      const agentDir = path.join(tempDir, 'to-delete');
      expect(fs.existsSync(agentDir)).toBe(true);

      await service.deleteWorkspace('to-delete');

      expect(fs.existsSync(agentDir)).toBe(false);
    });

    it('removes all scaffolded files inside the workspace', async () => {
      await service.scaffold('full-delete');
      await service.writeFile('full-delete', 'AGENT', 'some content');

      await service.deleteWorkspace('full-delete');

      const agentDir = path.join(tempDir, 'full-delete');
      expect(fs.existsSync(agentDir)).toBe(false);
    });

    it('is a no-op when the workspace directory does not exist', async () => {
      await expect(
        service.deleteWorkspace('never-existed'),
      ).resolves.toBeUndefined();
    });

    it('does not affect other agents workspaces', async () => {
      await service.scaffold('keep-me');
      await service.scaffold('delete-me');

      await service.deleteWorkspace('delete-me');

      expect(fs.existsSync(path.join(tempDir, 'keep-me'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'delete-me'))).toBe(false);
    });
  });

  describe('readAllForInjection', () => {
    it('returns empty array when no files exist', async () => {
      const result = await service.readAllForInjection('ghost-agent');
      expect(result).toEqual([]);
    });

    it('skips files that still contain only default content', async () => {
      await service.scaffold('default-agent');
      const result = await service.readAllForInjection('default-agent');
      expect(result).toEqual([]);
    });

    it('returns files with real content', async () => {
      await service.scaffold('real-agent');
      await service.writeFile(
        'real-agent',
        'AGENT',
        'I am a real agent with custom identity.',
      );

      const result = await service.readAllForInjection('real-agent');
      expect(result).toHaveLength(1);
      expect(result[0]!.meta.id).toBe('AGENT');
      expect(result[0]!.content).toContain('real agent');
    });
  });
});

describe('isDefaultContent', () => {
  it('returns true for content with only HTML comments and headings', () => {
    const content = `# Agent Identity\n\n<!--\n  some instructions\n-->`;
    expect(isDefaultContent(content)).toBe(true);
  });

  it('returns false for content with real text', () => {
    expect(isDefaultContent('I am a helpful assistant.')).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isDefaultContent('')).toBe(true);
  });
});
