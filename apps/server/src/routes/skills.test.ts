import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { skillRoutes } from './skills';
import { AuthMiddleware } from '../websocket/middleware/auth';
import { createAgentRegistry } from '../agents';
import type { AppConfigService } from '../config/service';
import { createProviderServices } from '../providers';
import { SessionMessageService } from '../sessions/service';
import { RunEventEmitter } from '../dispatch/events';
import { createSkillRegistry } from '../skills';
import { WorkspaceService } from '../workspace/service';
import type { AppServices } from '../types';

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

describe('Skill Routes', () => {
  let app: FastifyInstance;
  let tempAgentsDir: string;
  let tempSkillsDir: string;
  let tempWorkspaceDir: string;
  let workspace: WorkspaceService;

  beforeEach(async () => {
    // Create temp directories
    tempAgentsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'test-agents-skills-'),
    );
    tempSkillsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'test-skills-routes-'),
    );
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'test-workspace-skills-'),
    );
    workspace = new WorkspaceService({ baseDir: tempWorkspaceDir });

    // Create test skill directories
    fs.mkdirSync(path.join(tempSkillsDir, 'skill-a'));
    fs.mkdirSync(path.join(tempSkillsDir, 'skill-b'));

    // Create SKILL.md files
    fs.writeFileSync(
      path.join(tempSkillsDir, 'skill-a', 'SKILL.md'),
      [
        '---',
        'name: Skill A',
        'description: First test skill',
        '---',
        'This is skill A body content.',
      ].join('\n'),
    );

    fs.writeFileSync(
      path.join(tempSkillsDir, 'skill-b', 'SKILL.md'),
      [
        '---',
        'name: Skill B',
        'description: Second test skill',
        '---',
        'This is skill B body content.',
      ].join('\n'),
    );

    // Create test agent
    fs.writeFileSync(
      path.join(tempAgentsDir, 'default.json'),
      JSON.stringify({
        id: 'default',
        name: 'Default Agent',
        description: 'The default agent',
        enabled: true,
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4',
        defaults: { providerId: 'openai', modelId: 'gpt-4' },
      }),
    );

    // Create registries
    const agentRegistry = createAgentRegistry({ agentsDir: tempAgentsDir });
    const skillRegistry = createSkillRegistry({ skillsDir: tempSkillsDir });
    skillRegistry.load();

    // Build app
    const providerServices = createProviderServices();
    const sessionService = new SessionMessageService({
      providers: providerServices,
    });
    const runEvents = new RunEventEmitter();

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

    app = Fastify({ logger: false });

    app.decorate('services', {
      config: configServiceStub,
      providers: providerServices,
      sessions: sessionService,
      agents: agentRegistry,
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
      workspace: undefined as unknown as AppServices['workspace'],
      mcpService: undefined as unknown as AppServices['mcpService'],
      skills: skillRegistry,
      personality: undefined as unknown as AppServices['personality'],
    });

    await app.register(cors, { origin: '*' });
    await app.register(sensible);
    await app.register(websocket);
    await app.register(skillRoutes, {
      skillRegistry,
      agentRegistry,
      authMiddleware: mockAuthMiddleware,
      workspace,
      skillsDir: tempSkillsDir,
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempAgentsDir, { recursive: true, force: true });
    fs.rmSync(tempSkillsDir, { recursive: true, force: true });
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
  });

  describe('GET /skills', () => {
    it('returns 200 with skill items', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/skills',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBe(2);

      const ids = body.items.map((s: { id: string }) => s.id).sort();
      expect(ids).toEqual(['skill-a', 'skill-b']);
    });

    it('returns skill summaries with id, name, description', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/skills',
      });

      const body = response.json();
      const skillA = body.items.find((s: { id: string }) => s.id === 'skill-a');
      expect(skillA).toBeDefined();
      expect(skillA.name).toBe('Skill A');
      expect(skillA.description).toBe('First test skill');
    });

    it('returns empty items when no skills installed', async () => {
      // Create a registry with an empty skills dir
      const emptySkillsDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'empty-skills-'),
      );
      const emptySkillRegistry = createSkillRegistry({
        skillsDir: emptySkillsDir,
      });
      emptySkillRegistry.load();

      // Register new routes with empty registry
      const agentRegistry = createAgentRegistry({ agentsDir: tempAgentsDir });

      const tempApp = Fastify({ logger: false });
      tempApp.decorate('services', {
        config: {},
        providers: {},
        sessions: {},
        agents: agentRegistry,
        runEvents: {},
        dbAdapter: undefined,
        scheduler: undefined,
        jobsRepo: undefined,
        jobRunsRepo: undefined,
        sessionsRepo: undefined,
        bootstrapAdmin: undefined,
        pairingRequestsRepo: undefined,
        devicesRepo: undefined,
        accessTokensRepo: undefined,
        workspace: undefined,
        mcpService: undefined,
        skills: emptySkillRegistry,
      } as unknown as AppServices);

      await tempApp.register(skillRoutes, {
        skillRegistry: emptySkillRegistry,
        agentRegistry,
        authMiddleware: mockAuthMiddleware,
        workspace,
        skillsDir: tempSkillsDir,
      });

      const response = await tempApp.inject({
        method: 'GET',
        url: '/skills',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toEqual([]);

      await tempApp.close();
      fs.rmSync(emptySkillsDir, { recursive: true, force: true });
    });
  });

  describe('PATCH /agents/:agentId/skills', () => {
    it('returns 200 when updating agent skills with valid array', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: ['skill-a'] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.skills).toEqual(['skill-a']);
    });

    it('returns 200 when clearing agent skills with empty array', async () => {
      // First set skills
      await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: ['skill-a'] },
      });

      // Then clear them
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: [] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // Empty array clears skills (removes the field entirely)
      expect(body.skills).toBeUndefined();
    });

    it('returns 400 when skills is not an array', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: 'not-an-array' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('must be an array of strings');
    });

    it('returns 400 when skills contains non-strings', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: ['valid', 123, 'also-valid'] },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('must be an array of strings');
    });

    it('returns 404 when agent does not exist', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/ghost/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: ['skill-a'] },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toContain('Agent not found');
    });

    it('returns 400 when skills contains unknown skill IDs', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: ['skill-a', 'nonexistent', 'skill-b'] },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('Unknown skill(s)');
      expect(body.invalidSkills).toContain('nonexistent');
      expect(body.hint).toBeDefined();
    });

    it('returns 200 when all skills are valid', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: ['skill-a', 'skill-b'] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.skills).toEqual(['skill-a', 'skill-b']);
    });

    it('allows empty array to clear skills (even with no skills assigned)', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/default/skills',
        headers: { 'content-type': 'application/json' },
        payload: { skills: [] },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
