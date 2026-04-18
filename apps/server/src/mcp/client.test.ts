import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpClientService, createMcpClientService } from './client';
import type { McpServerConfig } from '@openaidy/config';

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
});
