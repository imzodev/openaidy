import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { agentRoutes } from './agents';
import { createAgentRegistry } from '../agents';
import type { AppConfigService } from '../config/service';
import { createProviderServices } from '../providers';
import { SessionMessageService } from '../sessions/service';
import { RunEventEmitter } from '../dispatch/events';

describe('Agent Routes', () => {
  let app: FastifyInstance;
  let tempDir: string;
  
  beforeEach(async () => {
    // Create a temporary directory for test agents
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-agents-routes-'));
    
    // Create test agents
    fs.writeFileSync(
      path.join(tempDir, 'default.json'),
      JSON.stringify({
        id: 'default',
        name: 'Default Agent',
        description: 'The default agent',
        enabled: true,
        systemPrompt: 'You are helpful.',
        defaults: { providerId: 'openai', modelId: 'gpt-4' },
        tags: ['general'],
      })
    );
    
    fs.writeFileSync(
      path.join(tempDir, 'disabled.json'),
      JSON.stringify({
        id: 'disabled',
        name: 'Disabled Agent',
        enabled: false,
        systemPrompt: 'Disabled prompt',
        defaults: {},
      })
    );
    
    fs.writeFileSync(
      path.join(tempDir, 'coder.json'),
      JSON.stringify({
        id: 'coder',
        name: 'Code Assistant',
        description: 'Helps with code',
        enabled: true,
        systemPrompt: 'You are a coding assistant.',
        defaults: { providerId: 'anthropic', modelId: 'claude-3' },
        tags: ['coding', 'development'],
      })
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
        defaults: { agentId: 'default', providerId: 'openai', modelId: 'gpt-4o-mini' },
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
    });
    
    await app.register(cors, { origin: '*' });
    await app.register(sensible);
    await app.register(websocket);
    await app.register(agentRoutes, { agentRegistry: testRegistry });
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
      const defaultAgent = body.items.find((a: { id: string }) => a.id === 'default');
      
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
      expect(agent.defaults).toEqual({ providerId: 'openai', modelId: 'gpt-4' });
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
});
