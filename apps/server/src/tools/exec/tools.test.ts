import { describe, it, expect } from 'vitest';
import { ExecService } from '../../exec/service';
import { createExecRunTool, createExecTools } from './index';

const CTX = { agentId: 'test-agent' };

describe('exec tools', () => {
  const exec = new ExecService();

  describe('createExecTools', () => {
    it('returns the exec_run tool', () => {
      const tools = createExecTools(exec);
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('exec_run');
    });
  });

  describe('exec_run', () => {
    it('runs a command and returns stdout', async () => {
      const tool = createExecRunTool(exec);
      const result = await tool.execute({ command: 'echo hello' }, CTX);

      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        'hello',
      );
      expect((result as { ok: true; content: string }).content).toContain(
        'exit code: 0',
      );
    });

    it('captures stderr separately', async () => {
      const tool = createExecRunTool(exec);
      const result = await tool.execute({ command: 'echo oops >&2' }, CTX);

      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        'stderr:',
      );
      expect((result as { ok: true; content: string }).content).toContain(
        'oops',
      );
    });

    it('returns non-zero exit code for failing commands', async () => {
      const tool = createExecRunTool(exec);
      const result = await tool.execute({ command: 'exit 42' }, CTX);

      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        'exit code: 42',
      );
    });

    it('supports pipes', async () => {
      const tool = createExecRunTool(exec);
      const result = await tool.execute(
        { command: 'echo "foo bar baz" | wc -w' },
        CTX,
      );

      expect(result.ok).toBe(true);
      const content = (result as { ok: true; content: string }).content;
      expect(content).toContain('3');
      expect(content).toContain('exit code: 0');
    });

    it('respects the cwd argument', async () => {
      const tool = createExecRunTool(exec);
      const result = await tool.execute({ command: 'pwd', cwd: '/tmp' }, CTX);

      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        '/tmp',
      );
    });

    it('returns an error for a missing command', async () => {
      const tool = createExecRunTool(exec);
      const result = await tool.execute({ command: '' }, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /non-empty/,
      );
    });

    it('returns an error when command is not a string', async () => {
      const tool = createExecRunTool(exec);
      const result = await tool.execute({ command: 123 }, CTX);

      expect(result.ok).toBe(false);
    });

    it('times out and marks result as timed out', async () => {
      const fastExec = new ExecService({ timeoutMs: 100 });
      const tool = createExecRunTool(fastExec);
      const result = await tool.execute({ command: 'sleep 10' }, CTX);

      expect(result.ok).toBe(true);
      const content = (result as { ok: true; content: string }).content;
      expect(content).toContain('timed out');
    });
  });
});
