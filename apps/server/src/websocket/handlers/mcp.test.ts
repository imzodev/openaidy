import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  McpHandler,
  createMcpHandler,
  registerMcpHandlers,
} from './mcp';
import type { McpClientService } from '../../mcp/client';
import type { FastifyBaseLogger } from 'fastify';
import type { HandlerContext } from '../index';
import { createWSMessage } from '@openaidy/shared-types';

describe('McpHandler', () => {
  let handler: McpHandler;
  let mockMcpService: McpClientService;
  let mockLogger: FastifyBaseLogger;
  const mockContext: HandlerContext = {} as HandlerContext;

  beforeEach(() => {
    mockMcpService = {
      isConnected: vi.fn().mockReturnValue(false),
      getConnectedServers: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as McpClientService;

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
      level: 'info',
      silent: false,
    } as unknown as FastifyBaseLogger;

    handler = createMcpHandler(mockMcpService, mockLogger);
  });

  describe('handleList', () => {
    it('should list all connected servers when no serverId provided', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(true);
      vi.mocked(mockMcpService.getConnectedServers).mockReturnValue([
        'filesystem',
        'github',
      ]);
      vi.mocked(mockMcpService.getTools).mockImplementation((id) => {
        if (id === 'filesystem') {
          return [
            { name: 'read_file', inputSchema: {} },
            { name: 'write_file', inputSchema: {} },
          ];
        }
        if (id === 'github') {
          return [{ name: 'search_repos', inputSchema: {} }];
        }
        return [];
      });

      const request = createWSMessage('mcp.list', {});
      const response = await handler.handleList('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.list');
      if (response.type === 'mcp.list') {
        expect(response.payload.servers).toHaveLength(2);
        expect(response.payload.servers[0].id).toBe('filesystem');
        expect(response.payload.servers[0].connected).toBe(true);
        expect(response.payload.servers[0].tools).toEqual([
          'read_file',
          'write_file',
        ]);
      }
    });

    it('should list specific server when serverId provided', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(true);
      vi.mocked(mockMcpService.getTools).mockReturnValue([
        { name: 'read_file', inputSchema: {} },
      ]);

      const request = createWSMessage('mcp.list', { serverId: 'filesystem' });
      const response = await handler.handleList('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.list');
      if (response.type === 'mcp.list') {
        expect(response.payload.servers).toHaveLength(1);
        expect(response.payload.servers[0].id).toBe('filesystem');
        expect(response.payload.servers[0].connected).toBe(true);
        expect(response.payload.servers[0].tools).toEqual(['read_file']);
      }
    });

    it('should show disconnected server with empty tools', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(false);

      const request = createWSMessage('mcp.list', { serverId: 'filesystem' });
      const response = await handler.handleList('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.list');
      if (response.type === 'mcp.list') {
        expect(response.payload.servers[0].connected).toBe(false);
        expect(response.payload.servers[0].tools).toEqual([]);
      }
    });

    it('should return empty servers list when none connected', async () => {
      const request = createWSMessage('mcp.list', {});
      const response = await handler.handleList('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.list');
      if (response.type === 'mcp.list') {
        expect(response.payload.servers).toEqual([]);
      }
    });
  });

  describe('handleCall', () => {
    it('should require serverId and tool', async () => {
      const request = createWSMessage('mcp.call', {
        serverId: '',
        tool: '',
        arguments: {},
      });
      const response = await handler.handleCall('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe('INVALID_PAYLOAD');
      }
    });

    it('should fail for disconnected server', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(false);

      const request = createWSMessage('mcp.call', {
        serverId: 'filesystem',
        tool: 'read_file',
        arguments: { path: '/test.txt' },
      });
      const response = await handler.handleCall('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe('NOT_FOUND');
        expect(response.payload.error.message).toContain('not connected');
      }
    });

    it('should call tool successfully', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(true);
      vi.mocked(mockMcpService.callTool).mockResolvedValue({
        content: [{ type: 'text', text: 'file content' }],
      });

      const request = createWSMessage('mcp.call', {
        serverId: 'filesystem',
        tool: 'read_file',
        arguments: { path: '/test.txt' },
      });
      const response = await handler.handleCall('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.call');
      if (response.type === 'mcp.call') {
        expect(response.payload.serverId).toBe('filesystem');
        expect(response.payload.tool).toBe('read_file');
        expect(response.payload.result).toBeDefined();
      }
      expect(mockMcpService.callTool).toHaveBeenCalledWith('filesystem', 'read_file', {
        path: '/test.txt',
      });
    });

    it('should handle tool execution errors', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(true);
      vi.mocked(mockMcpService.callTool).mockRejectedValue(
        new Error('Tool execution failed'),
      );

      const request = createWSMessage('mcp.call', {
        serverId: 'filesystem',
        tool: 'read_file',
        arguments: { path: '/test.txt' },
      });
      const response = await handler.handleCall('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.message).toContain('Tool execution failed');
      }
    });
  });

  describe('handleConnect', () => {
    it('should require config with id', async () => {
      const request = createWSMessage('mcp.connect', {
        config: {} as any,
      });
      const response = await handler.handleConnect('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe('INVALID_PAYLOAD');
      }
    });

    it('should return success if already connected', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(true);

      const request = createWSMessage('mcp.connect', {
        config: {
          id: 'filesystem',
          transport: 'stdio',
          command: 'npx',
          args: [],
        },
      });
      const response = await handler.handleConnect('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.connect');
      if (response.type === 'mcp.connect') {
        expect(response.payload.connected).toBe(true);
        expect(response.payload.serverId).toBe('filesystem');
      }
      expect(mockMcpService.connect).not.toHaveBeenCalled();
    });

    it('should connect successfully', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(false);
      vi.mocked(mockMcpService.connect).mockResolvedValue(undefined);

      const request = createWSMessage('mcp.connect', {
        config: {
          id: 'filesystem',
          transport: 'stdio',
          command: 'npx',
          args: [],
        },
      });
      const response = await handler.handleConnect('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.connect');
      if (response.type === 'mcp.connect') {
        expect(response.payload.connected).toBe(true);
        expect(response.payload.serverId).toBe('filesystem');
      }
      expect(mockMcpService.connect).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      vi.mocked(mockMcpService.isConnected).mockReturnValue(false);
      vi.mocked(mockMcpService.connect).mockRejectedValue(
        new Error('Connection failed'),
      );

      const request = createWSMessage('mcp.connect', {
        config: {
          id: 'filesystem',
          transport: 'stdio',
          command: 'npx',
          args: [],
        },
      });
      const response = await handler.handleConnect('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.message).toContain('Connection failed');
      }
    });
  });

  describe('handleDisconnect', () => {
    it('should require serverId', async () => {
      const request = createWSMessage('mcp.disconnect', {
        serverId: '',
      });
      const response = await handler.handleDisconnect('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe('INVALID_PAYLOAD');
      }
    });

    it('should disconnect successfully', async () => {
      vi.mocked(mockMcpService.disconnect).mockResolvedValue(undefined);

      const request = createWSMessage('mcp.disconnect', {
        serverId: 'filesystem',
      });
      const response = await handler.handleDisconnect('conn-1', request, mockContext);

      expect(response.type).toBe('mcp.disconnect');
      if (response.type === 'mcp.disconnect') {
        expect(response.payload.disconnected).toBe(true);
        expect(response.payload.serverId).toBe('filesystem');
      }
      expect(mockMcpService.disconnect).toHaveBeenCalledWith('filesystem');
    });

    it('should handle disconnection errors', async () => {
      vi.mocked(mockMcpService.disconnect).mockRejectedValue(
        new Error('Disconnection failed'),
      );

      const request = createWSMessage('mcp.disconnect', {
        serverId: 'filesystem',
      });
      const response = await handler.handleDisconnect('conn-1', request, mockContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.message).toContain('Disconnection failed');
      }
    });
  });

  describe('registerMcpHandlers', () => {
    it('should register all MCP handlers', () => {
      const mockRouter = {
        registerHandler: vi.fn(),
      };

      registerMcpHandlers(mockRouter as any, handler);

      expect(mockRouter.registerHandler).toHaveBeenCalledTimes(4);
      expect(mockRouter.registerHandler).toHaveBeenCalledWith(
        'mcp.list',
        expect.any(Function),
      );
      expect(mockRouter.registerHandler).toHaveBeenCalledWith(
        'mcp.call',
        expect.any(Function),
      );
      expect(mockRouter.registerHandler).toHaveBeenCalledWith(
        'mcp.connect',
        expect.any(Function),
      );
      expect(mockRouter.registerHandler).toHaveBeenCalledWith(
        'mcp.disconnect',
        expect.any(Function),
      );
    });
  });
});
