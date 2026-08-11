import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpClientService, createMcpClientService } from './client';
import {
  EnvPlaceholderResolver,
  MissingEnvVarsError,
} from './placeholder-resolver';
import type { McpServerConfig } from '@openaidy/config';
import type { UvxEnvironmentRepairer } from './uvx-repair';

describe('McpClientService', () => {
  let mcpService: McpClientService;

  beforeEach(() => {
    mcpService = createMcpClientService();
  });

  afterEach(async () => {
    await mcpService.disconnectAll();
  });

  describe('constructor', () => {
    it('should create service without options', () => {
      const service = createMcpClientService();
      expect(service).toBeInstanceOf(McpClientService);
    });

    it('should create service with logger', () => {
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(),
        level: 'info',
        silent: false,
      };
      const service = createMcpClientService({
        logger: mockLogger as unknown as McpClientService['logger'],
      });
      expect(service).toBeInstanceOf(McpClientService);
    });
  });

  describe('isConnected', () => {
    it('should return false before connect', () => {
      expect(mcpService.isConnected('test')).toBe(false);
    });

    it('should return false for unknown server', () => {
      expect(mcpService.isConnected('unknown')).toBe(false);
    });
  });

  describe('getConnectedServers', () => {
    it('should return empty array before any connections', () => {
      expect(mcpService.getConnectedServers()).toEqual([]);
    });
  });

  describe('getTools', () => {
    it('should return empty array for unconnected server', () => {
      expect(mcpService.getTools('unknown')).toEqual([]);
    });
  });

  describe('getFilteredTools', () => {
    it('should return empty array for unconnected server', () => {
      expect(mcpService.getFilteredTools('unknown')).toEqual([]);
    });

    it('should return empty array when no tools discovered', () => {
      expect(
        mcpService.getFilteredTools('unknown', ['tool1', 'tool2']),
      ).toEqual([]);
    });
  });

  describe('connect', () => {
    it('should reject invalid transport type', async () => {
      const config = {
        id: 'test',
        transport: 'invalid' as 'stdio' | 'http',
      };
      await expect(mcpService.connect(config)).rejects.toThrow(
        'Unsupported transport type',
      );
    });

    it('should reject stdio without command', async () => {
      const config: McpServerConfig = {
        id: 'test',
        transport: 'stdio',
      };
      await expect(mcpService.connect(config)).rejects.toThrow(
        'requires command',
      );
    });

    it('should reject http without url', async () => {
      const config: McpServerConfig = {
        id: 'test',
        transport: 'http',
      };
      await expect(mcpService.connect(config)).rejects.toThrow('requires url');
    });

    it('should reject http transport with connection error', async () => {
      const config: McpServerConfig = {
        id: 'test',
        transport: 'http',
        url: 'http://localhost:3000/mcp',
      };
      await expect(mcpService.connect(config)).rejects.toThrow(
        'Failed to connect to MCP server',
      );
    });

    it('should reject stdio with empty command', async () => {
      const config: McpServerConfig = {
        id: 'test',
        transport: 'stdio',
        command: '',
      };
      await expect(mcpService.connect(config)).rejects.toThrow(
        'requires command',
      );
    });
  });

  describe('env/header placeholder resolution', () => {
    it('fails fast (before spawning) when a stdio env placeholder is unset', async () => {
      const service = createMcpClientService({
        resolver: new EnvPlaceholderResolver({}),
      });
      const config: McpServerConfig = {
        id: 'stdio-missing',
        transport: 'stdio',
        command: 'echo',
        env: { TOKEN: '${MISSING_VAR}' },
      };
      await expect(service.connect(config)).rejects.toBeInstanceOf(
        MissingEnvVarsError,
      );
      expect(service.isConnected('stdio-missing')).toBe(false);
    });

    it('fails fast (before connecting) when an http header placeholder is unset', async () => {
      const service = createMcpClientService({
        resolver: new EnvPlaceholderResolver({}),
      });
      const config: McpServerConfig = {
        id: 'http-missing',
        transport: 'http',
        url: 'http://localhost:1/mcp',
        headers: { Authorization: 'Bearer ${MISSING_VAR}' },
      };
      await expect(service.connect(config)).rejects.toBeInstanceOf(
        MissingEnvVarsError,
      );
    });

    it('passes header resolution when the var is set (fails later at the network)', async () => {
      const service = createMcpClientService({
        resolver: new EnvPlaceholderResolver({ GH_TOKEN: 'ghp_x' }),
      });
      const config: McpServerConfig = {
        id: 'http-resolved',
        transport: 'http',
        url: 'http://localhost:1/mcp',
        headers: { Authorization: 'Bearer ${GH_TOKEN}' },
      };
      // Resolution succeeded (no MissingEnvVarsError); the connection then
      // fails at the transport/network layer with the wrapped message.
      await expect(service.connect(config)).rejects.toThrow(
        'Failed to connect to MCP server',
      );
    });
  });

  describe('missingSecrets', () => {
    it('reports unset ${VAR} placeholders in a stdio server env', () => {
      const service = createMcpClientService({
        resolver: new EnvPlaceholderResolver({}),
      });
      const config: McpServerConfig = {
        id: 'gh',
        transport: 'stdio',
        command: 'npx',
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}',
        },
      };
      expect(service.missingSecrets(config)).toEqual([
        'GITHUB_PERSONAL_ACCESS_TOKEN',
      ]);
    });

    it('reports unset ${VAR} placeholders in an http server headers', () => {
      const service = createMcpClientService({
        resolver: new EnvPlaceholderResolver({}),
      });
      const config: McpServerConfig = {
        id: 'gh',
        transport: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer ${GH_TOKEN}' },
      };
      expect(service.missingSecrets(config)).toEqual(['GH_TOKEN']);
    });

    it('is empty once the secret is set (ready to connect)', () => {
      const service = createMcpClientService({
        resolver: new EnvPlaceholderResolver({ GH_TOKEN: 'ghp_x' }),
      });
      const config: McpServerConfig = {
        id: 'gh',
        transport: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer ${GH_TOKEN}' },
      };
      expect(service.missingSecrets(config)).toEqual([]);
    });

    it('is empty for a server with no secret-bearing fields', () => {
      const service = createMcpClientService({
        resolver: new EnvPlaceholderResolver({}),
      });
      const config: McpServerConfig = {
        id: 'fs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'server-filesystem', '.'],
      };
      expect(service.missingSecrets(config)).toEqual([]);
    });
  });

  describe('callTool', () => {
    it('should throw for unconnected server', async () => {
      await expect(
        mcpService.callTool('unknown', 'test-tool', {}),
      ).rejects.toThrow('not connected');
    });
  });

  describe('disconnect', () => {
    it('should not throw for unconnected server', async () => {
      await expect(mcpService.disconnect('unknown')).resolves.toBeUndefined();
    });
  });

  describe('disconnectAll', () => {
    it('should not throw when no connections', async () => {
      await expect(mcpService.disconnectAll()).resolves.toBeUndefined();
    });
  });
});

describe('McpClientService with mock MCP server', () => {
  let mcpService: McpClientService;

  beforeEach(() => {
    mcpService = createMcpClientService();
  });

  afterEach(async () => {
    await mcpService.disconnectAll();
  });

  // Note: These tests would require a real or mock MCP server process
  // For now, we test the basic error handling paths

  it('should handle connection failure gracefully', async () => {
    const config: McpServerConfig = {
      id: 'failing-server',
      transport: 'stdio',
      command: 'nonexistent-command-that-does-not-exist',
      args: [],
    };

    // This should fail because the command doesn't exist
    await expect(mcpService.connect(config)).rejects.toThrow();
    expect(mcpService.isConnected('failing-server')).toBe(false);
  });
  describe('uvx environment repair', () => {
    // A stdio server that dies at launch the way a uvx package with a drifted
    // dependency set does: an import error on stderr, then a non-zero exit.
    // `client.connect()` sees only "Connection closed", so the stderr tail is
    // the only signal the repair can act on.
    const brokenServer = (id: string): McpServerConfig => ({
      id,
      transport: 'stdio',
      command: 'node',
      args: [
        '-e',
        'process.stderr.write("ModuleNotFoundError: No module named mcp.server.fastmcp"); process.exit(1)',
      ],
    });

    it('hands the captured stderr to the repairer when a launch fails', async () => {
      const repairer = vi.fn<UvxEnvironmentRepairer>(async () => null);
      const service = createMcpClientService({ uvxRepairer: repairer });

      await expect(service.connect(brokenServer('probe'))).rejects.toThrow();

      expect(repairer).toHaveBeenCalledTimes(1);
      const input = repairer.mock.calls[0]?.[0];
      expect(input).toMatchObject({ serverId: 'probe', command: 'node' });
      expect(input?.stderr).toContain('ModuleNotFoundError');
      expect(service.isConnected('probe')).toBe(false);
    });

    it('retries exactly once when the repair succeeds, never looping', async () => {
      // Always reports success, so a missing retry guard would recurse forever.
      const repairer = vi.fn<UvxEnvironmentRepairer>(async () => '2026-02-11');
      const service = createMcpClientService({ uvxRepairer: repairer });

      await expect(service.connect(brokenServer('loopy'))).rejects.toThrow();

      expect(repairer).toHaveBeenCalledTimes(1);
      expect(service.isConnected('loopy')).toBe(false);
    });

    it('sets UV_EXCLUDE_NEWER on the retry, not just a side-channel uv tool install', async () => {
      // Echoes the pin it actually received on stderr, so the test can tell
      // the bound reached the real spawned process rather than only a
      // separate `uv tool install` call that the launch never reuses.
      const echoBound: McpServerConfig = {
        id: 'pinned',
        transport: 'stdio',
        command: 'node',
        args: [
          '-e',
          'process.stderr.write(process.env.UV_EXCLUDE_NEWER ? "pinned:" + process.env.UV_EXCLUDE_NEWER : "ModuleNotFoundError: No module named mcp.server.fastmcp"); process.exit(1);',
        ],
      };
      const repairer = vi.fn<UvxEnvironmentRepairer>(async () => '2026-02-11');
      const stderrChunks: string[] = [];
      const logger = {
        info: vi.fn(),
        warn: vi.fn((obj: { stderr?: string }) => {
          if (obj?.stderr) stderrChunks.push(obj.stderr);
        }),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(),
        level: 'info',
        silent: false,
      };
      const service = createMcpClientService({
        uvxRepairer: repairer,
        logger: logger as unknown as McpClientService['logger'],
      });

      await expect(service.connect(echoBound)).rejects.toThrow();

      expect(repairer).toHaveBeenCalledTimes(1);
      expect(
        stderrChunks.some((chunk) => chunk.includes('pinned:2026-02-11')),
      ).toBe(true);
    });

    it('does not attempt repair when it is disabled', async () => {
      const service = createMcpClientService({ uvxRepairer: null });
      await expect(
        service.connect(brokenServer('no-repair')),
      ).rejects.toThrow();
      expect(service.isConnected('no-repair')).toBe(false);
    });
  });
});
