import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecService } from '../../exec/service';
import { createWorkspaceService } from '../../workspace/service';
import { createExecRunTool, createExecTools } from './index';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

// Some cases exercise the shell with POSIX-only commands (pwd, wc, sleep).
// On Windows ExecService correctly spawns cmd.exe, where those commands don't
// exist, so we skip them there; they run in full on the Linux CI runner.
const itUnix = it.skipIf(process.platform === 'win32');

describe('exec tools', () => {
  let testBaseDir: string;
  let workspace: ReturnType<typeof createWorkspaceService>;
  const exec = new ExecService();

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `exec-tools-test-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    workspace = createWorkspaceService({ baseDir: testBaseDir });
    await workspace.ensureWorkspace(CTX.agentId);
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  describe('createExecTools', () => {
    it('returns the exec_run tool', () => {
      const tools = createExecTools(exec, workspace);
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('exec_run');
    });
  });

  describe('exec_run', () => {
    it('runs a command and returns stdout', async () => {
      const tool = createExecRunTool(exec, workspace);
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
      const tool = createExecRunTool(exec, workspace);
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
      const tool = createExecRunTool(exec, workspace);
      const result = await tool.execute({ command: 'exit 42' }, CTX);

      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        'exit code: 42',
      );
    });

    itUnix('supports pipes', async () => {
      const tool = createExecRunTool(exec, workspace);
      const result = await tool.execute(
        { command: 'echo "foo bar baz" | wc -w' },
        CTX,
      );

      expect(result.ok).toBe(true);
      const content = (result as { ok: true; content: string }).content;
      expect(content).toContain('3');
      expect(content).toContain('exit code: 0');
    });

    itUnix('defaults cwd to the agent workspace root', async () => {
      const tool = createExecRunTool(exec, workspace);
      const result = await tool.execute({ command: 'pwd' }, CTX);

      expect(result.ok).toBe(true);
      // `pwd` reports the cwd using the shell's native path style (which can
      // differ from Node's OS-native separators, e.g. POSIX-style under Git
      // Bash on Windows). Normalize separators and compare on the stable
      // trailing segments: <unique-base-dir>/<agentId>.
      const content = (result as { ok: true; content: string }).content.replace(
        /\\/g,
        '/',
      );
      const expectedTail = `${basename(testBaseDir)}/${CTX.agentId}`;
      expect(content).toContain(expectedTail);
    });

    itUnix('accepts a relative cwd inside the workspace', async () => {
      const tool = createExecRunTool(exec, workspace);
      const workspaceRoot = workspace.getWorkspacePath(CTX.agentId);
      await mkdir(join(workspaceRoot, 'subdir'), { recursive: true });

      const result = await tool.execute({ command: 'pwd', cwd: 'subdir' }, CTX);

      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        'subdir',
      );
    });

    it('rejects a cwd that escapes the workspace', async () => {
      const tool = createExecRunTool(exec, workspace);
      const result = await tool.execute(
        { command: 'pwd', cwd: '../../etc' },
        CTX,
      );

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /within the agent workspace/,
      );
    });

    it('rejects a cwd that is an absolute path outside the workspace', async () => {
      const tool = createExecRunTool(exec, workspace);
      const result = await tool.execute({ command: 'pwd', cwd: '/etc' }, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /within the agent workspace/,
      );
    });

    it('returns an error for a missing command', async () => {
      const tool = createExecRunTool(exec, workspace);
      const result = await tool.execute({ command: '' }, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /non-empty/,
      );
    });

    it('returns an error when command is not a string', async () => {
      const tool = createExecRunTool(exec, workspace);
      const result = await tool.execute({ command: 123 }, CTX);

      expect(result.ok).toBe(false);
    });

    itUnix('times out and marks result as timed out', async () => {
      const fastExec = new ExecService({ timeoutMs: 100 });
      const tool = createExecRunTool(fastExec, workspace);
      const result = await tool.execute({ command: 'sleep 10' }, CTX);

      expect(result.ok).toBe(true);
      const content = (result as { ok: true; content: string }).content;
      expect(content).toContain('timed out');
    });

    describe('blocklist', () => {
      it('blocks rm -rf', async () => {
        const tool = createExecRunTool(exec, workspace);
        const result = await tool.execute(
          { command: 'rm -rf /some/path' },
          CTX,
        );
        expect(result.ok).toBe(false);
        expect((result as { ok: false; error: string }).error).toMatch(
          /Command blocked/,
        );
      });

      it('blocks sudo', async () => {
        const tool = createExecRunTool(exec, workspace);
        const result = await tool.execute(
          { command: 'sudo apt-get install something' },
          CTX,
        );
        expect(result.ok).toBe(false);
        expect((result as { ok: false; error: string }).error).toMatch(
          /Command blocked/,
        );
      });

      it('blocks dd writing to a device', async () => {
        const tool = createExecRunTool(exec, workspace);
        const result = await tool.execute(
          { command: 'dd if=/dev/zero of=/dev/sda' },
          CTX,
        );
        expect(result.ok).toBe(false);
        expect((result as { ok: false; error: string }).error).toMatch(
          /Command blocked/,
        );
      });

      it('allows safe commands not on the blocklist', async () => {
        const tool = createExecRunTool(exec, workspace);
        const result = await tool.execute({ command: 'echo safe' }, CTX);
        expect(result.ok).toBe(true);
      });
    });
  });
});
