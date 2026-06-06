import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { agentRoutes } from './agents';
import { AuthMiddleware } from '../websocket/middleware/auth';
import { createAgentRegistry } from '../agents';
import { createAgentPersonalityService } from '../agents/personality-service';
import type { AppConfigService } from '../config/service';
import { createProviderServices } from '../providers';
import { SessionMessageService } from '../sessions/service';
import { RunEventEmitter } from '../dispatch/events';

const mockAuthMiddleware = {
  validateToken: async () => ({
    sub: 'test',
    scopes: ['*'],
    type: 'access' as const,
    iat: 0,
    exp: 9999999999,
  }),
  extractFromHeader: (_h: string) => 'test-token',
  hasCapability: () => true,
} as unknown as AuthMiddleware;

describe('Agent Routes', () => {
  let app: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test agents in the system temp dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-agents-routes-'));

    // Create test agents
    fs.writeFileSync(
      path.join(tempDir, 'default.json'),
      JSON.stringify({
        id: 'default',
        name: 'Default Agent',
        description: 'The default agent',
        enabled: true,
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4',
        defaults: { providerId: 'openai', modelId: 'gpt-4' },
        tags: ['general'],
      }),
    );

    fs.writeFileSync(
      path.join(tempDir, 'disabled.json'),
      JSON.stringify({
        id: 'disabled',
        name: 'Disabled Agent',
        enabled: false,
        systemPrompt: 'Disabled prompt',
        model: 'openai/gpt-4',
        defaults: {},
      }),
    );

    fs.writeFileSync(
      path.join(tempDir, 'coder.json'),
      JSON.stringify({
        id: 'coder',
        name: 'Code Assistant',
        description: 'Helps with code',
        enabled: true,
        systemPrompt: 'You are a coding assistant.',
        model: 'anthropic/claude-3',
        defaults: { providerId: 'anthropic', modelId: 'claude-3' },
        tags: ['coding', 'development'],
      }),
    );

    // Create test registry with temp directory
    const testRegistry = createAgentRegistry({ agentsDir: tempDir });

    // Build a minimal app with agent routes
    const providerServices = createProviderServices();
    const sessionService = new SessionMessageService({
      providers: providerServices,
    });
    const runEvents = new RunEventEmitter();

    app = Fastify({ logger: false });

    const configServiceStub = {
      getConfig: () => ({
        version: 1,
        defaults: {
          agentId: 'default',
          providerId: 'openai',
          modelId: 'gpt-4o-mini',
        },
        providers: [],
        agents: [],
      }),
      getStatus: () => ({ issues: [] }),
    } as unknown as AppConfigService;

    app.decorate('services', {
      config: configServiceStub,
      providers: providerServices,
      sessions: sessionService,
      agents: testRegistry,
      runEvents,
      dbAdapter: undefined,
      scheduler: undefined,
      jobsRepo: undefined,
      jobRunsRepo: undefined,
      sessionsRepo: undefined,
      bootstrapAdmin: undefined,
      pairingRequestsRepo: undefined,
      devicesRepo: undefined,
      accessTokensRepo: undefined,
      workspace: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mcpService: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      skills: {
        load: () => {},
        listSkills: () => [],
        getSkill: () => undefined,
        getSkillsForAgent: () => [],
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      personality: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      taskSchedules: undefined,
      channels: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    await app.register(cors, { origin: '*' });
    await app.register(sensible);
    await app.register(websocket);
    await app.register(agentRoutes, {
      agentRegistry: testRegistry,
      personalityService: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      authMiddleware: mockAuthMiddleware,
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('GET /agents', () => {
    it('should return list of enabled agents', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBe(2); // Only enabled agents

      const ids = body.items.map((a: { id: string }) => a.id);
      expect(ids).toContain('default');
      expect(ids).toContain('coder');
      expect(ids).not.toContain('disabled');
    });

    it('should return agent summaries without systemPrompt', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents',
      });

      const body = response.json();
      const defaultAgent = body.items.find(
        (a: { id: string }) => a.id === 'default',
      );

      expect(defaultAgent).toBeDefined();
      expect(defaultAgent.name).toBe('Default Agent');
      expect(defaultAgent.description).toBe('The default agent');
      expect(defaultAgent.enabled).toBe(true);
      expect(defaultAgent.tags).toEqual(['general']);
      expect(defaultAgent.systemPrompt).toBeUndefined();
    });
  });

  describe('GET /agents/:agentId', () => {
    it('should return full agent by id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/default',
      });

      expect(response.statusCode).toBe(200);
      const agent = response.json();

      expect(agent.id).toBe('default');
      expect(agent.name).toBe('Default Agent');
      expect(agent.description).toBe('The default agent');
      expect(agent.enabled).toBe(true);
      expect(agent.systemPrompt).toBe('You are helpful.');
      expect(agent.model).toBe('openai/gpt-4');
      expect(agent.tags).toEqual(['general']);
    });

    it('should return disabled agent by id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/disabled',
      });

      expect(response.statusCode).toBe(200);
      const agent = response.json();

      expect(agent.id).toBe('disabled');
      expect(agent.enabled).toBe(false);
    });

    it('should return 404 for non-existent agent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/non-existent',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();

      expect(body.error).toBe('Agent not found');
      expect(body.agentId).toBe('non-existent');
    });
  });

  describe('PATCH /agents/:agentId/tools', () => {
    it('should update tools for an agent and return updated summary', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/tools',
        payload: { tools: ['workspace_read', 'workspace_list'] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe('default');
    });

    it('should accept an empty tools array to clear tools', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/tools',
        payload: { tools: [] },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 400 when tools is missing from the body', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/tools',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toMatch(/tools must be an array/);
    });

    it('should return 400 when tools contains non-string values', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/tools',
        payload: { tools: [1, 2, 3] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for a non-existent agent', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/ghost/tools',
        payload: { tools: ['workspace_read'] },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe('Agent not found');
    });
  });

  describe('PATCH /agents/:agentId/mcp-servers', () => {
    it('should update mcpServers for an agent and return updated summary', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/mcp-servers',
        payload: {
          mcpServers: [
            { id: 'filesystem' },
            { id: 'github', tools: ['search_code'] },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe('default');
      expect(body.mcpServers).toEqual([
        { id: 'filesystem' },
        { id: 'github', tools: ['search_code'] },
      ]);
    });

    it('should accept an empty mcpServers array to clear all servers', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/mcp-servers',
        payload: { mcpServers: [] },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 400 when mcpServers is missing from the body', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/mcp-servers',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toMatch(/mcpServers must be an array/);
    });

    it('should return 400 when a ref is missing the id field', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/mcp-servers',
        payload: { mcpServers: [{ tools: ['foo'] }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when tools is not an array of strings', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/mcp-servers',
        payload: { mcpServers: [{ id: 'srv', tools: [42] }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for a non-existent agent', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/ghost/mcp-servers',
        payload: { mcpServers: [{ id: 'filesystem' }] },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe('Agent not found');
    });
  });

  describe('DELETE /agents/:agentId', () => {
    it('returns 200 and the deleted agent summary', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/agents/coder',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.deleted).toBeDefined();
      expect(body.deleted.id).toBe('coder');
    });

    it('removes the agent from the registry', async () => {
      await app.inject({ method: 'DELETE', url: '/agents/coder' });

      const listResponse = await app.inject({ method: 'GET', url: '/agents' });
      const ids = listResponse.json().items.map((a: { id: string }) => a.id);
      expect(ids).not.toContain('coder');
    });

    it('returns 404 for a non-existent agent', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/agents/ghost',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBe('Agent not found');
    });
  });
});

describe('DELETE /agents/:agentId — workspace deletion', () => {
  let app: FastifyInstance;
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'test-agents-ws-delete-'),
    );

    const registry = createAgentRegistry({ initialAgents: [] });
    registry.replaceAll([
      {
        id: 'ws-agent',
        name: 'WS Agent',
        enabled: true,
        systemPrompt: 'Prompt',
        model: 'openai/gpt-4o-mini',
        version: 1,
      },
    ]);

    const personalityService = createAgentPersonalityService({
      workspaceBaseDir: workspaceDir,
    });

    await personalityService.scaffold('ws-agent');

    const providerServices = createProviderServices();
    const sessionService = new SessionMessageService({
      providers: providerServices,
    });
    const runEvents = new RunEventEmitter();

    const configServiceStub = {
      getConfig: () => ({
        version: 1,
        defaults: {
          agentId: 'ws-agent',
          providerId: 'openai',
          modelId: 'gpt-4o-mini',
        },
        providers: [],
        agents: [],
      }),
      getStatus: () => ({ issues: [] }),
    } as unknown as AppConfigService;

    app = Fastify({ logger: false });
    app.decorate('services', {
      config: configServiceStub,
      providers: providerServices,
      sessions: sessionService,
      agents: registry,
      runEvents,
      dbAdapter: undefined,
      scheduler: undefined,
      jobsRepo: undefined,
      jobRunsRepo: undefined,
      sessionsRepo: undefined,
      bootstrapAdmin: undefined,
      pairingRequestsRepo: undefined,
      devicesRepo: undefined,
      accessTokensRepo: undefined,
      workspace: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mcpService: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      skills: {
        load: () => {},
        listSkills: () => [],
        getSkill: () => undefined,
        getSkillsForAgent: () => [],
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      personality: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      taskSchedules: undefined,
      channels: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    await app.register(cors, { origin: '*' });
    await app.register(sensible);
    await app.register(websocket);
    await app.register(agentRoutes, {
      agentRegistry: registry,
      personalityService,
      authMiddleware: mockAuthMiddleware,
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('deletes the agent workspace directory when the agent is deleted', async () => {
    const agentDir = path.join(workspaceDir, 'ws-agent');
    expect(fs.existsSync(agentDir)).toBe(true);

    const response = await app.inject({
      method: 'DELETE',
      url: '/agents/ws-agent',
    });

    expect(response.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fs.existsSync(agentDir)).toBe(false);
  });

  it('calls deleteWorkspace on the personality service', async () => {
    const personalityService = createAgentPersonalityService({
      workspaceBaseDir: workspaceDir,
    });
    const spy = vi.spyOn(personalityService, 'deleteWorkspace');

    const registry2 = createAgentRegistry({ initialAgents: [] });
    registry2.replaceAll([
      {
        id: 'spy-agent',
        name: 'Spy Agent',
        enabled: true,
        systemPrompt: 'Prompt',
        model: 'openai/gpt-4o-mini',
        version: 1,
      },
    ]);

    const spyApp = Fastify({ logger: false });
    spyApp.decorate('services', {} as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    await spyApp.register(cors, { origin: '*' });
    await spyApp.register(sensible);
    await spyApp.register(websocket);
    await spyApp.register(agentRoutes, {
      agentRegistry: registry2,
      personalityService,
      authMiddleware: mockAuthMiddleware,
    });

    await spyApp.inject({ method: 'DELETE', url: '/agents/spy-agent' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith('spy-agent');

    await spyApp.close();
  });
});
