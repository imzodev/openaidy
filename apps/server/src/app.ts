import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import {
  type DatabaseAdapter,
  type AccessTokensStore,
  type DevicesStore,
  type JobsStore,
  type JobRunsStore,
  type PairingRequestsStore,
  type SessionsStore,
  createDatabaseAdapter,
} from '@openaidy/db';
import { env } from './lib/env';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { accessTokenRoutes } from './routes/access-tokens';
import { createAccessTokenService } from './access-tokens/service';
import { sessionRoutes } from './routes/sessions';
import { configRoutes } from './routes/config';
import { providerRoutes } from './routes/providers';
import { agentRoutes } from './routes/agents';
import { runStreamRoutes } from './routes/runs';
import { schedulerRoutes } from './routes/scheduler';
import { pulseRoutes } from './routes/pulses';
import { workspaceRoutes } from './routes/workspace';
import { logRoutes } from './routes/logs';
import { createMcpRoutesPlugin } from './routes/mcp';
import { addonRoutes } from './routes/addons';
import { addonProxyRoutes } from './addons/proxy-routes';
import { ManifestValidator } from './addons/manifest-validator';
import { createAddonService } from './addons/service';
import { taskRoutes } from './routes/tasks';
import { createTaskService } from './tasks';
import { createPlanningService } from './planning';
import { createMcpClientService } from './mcp/client';
import { createProviderServices } from './providers';
import { SessionMessageService } from './sessions/service';
import { createAgentRegistry } from './agents';
import { RunEventEmitter } from './dispatch';
import { SchedulerService, createSchedulerService } from './scheduler';
import { createAppConfigService } from './config/service';
import { websocketGatewayPlugin } from './websocket';
import { BootstrapAdminManager } from './bootstrap-admin';
import { AuthMiddleware } from './websocket/middleware/auth';
import { createWorkspaceService } from './workspace';
import { createExecService } from './exec/service';
import { createBuiltinToolRegistry } from './tools';
import { toolRoutes } from './routes/tools';
import { createSkillRegistry } from './skills';
import { skillRoutes } from './routes/skills';
import { seedBundledSkills } from './skills/seed';
import { createAgentPersonalityService } from './agents/personality-service';
import { createChannelRegistry } from './channels/index.js';
import { channelRoutes } from './routes/channels.js';
import path from 'node:path';
import type { AppServices } from './types';

/**
 * Build the Fastify application with unified service lifecycle
 */
export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });
  const wsConfig = {
    enabled: env.WS_ENABLED,
    port: env.WS_PORT,
    path: env.WS_PATH,
    maxConnections: env.WS_MAX_CONNECTIONS,
    heartbeatInterval: env.WS_HEARTBEAT_INTERVAL,
    auth: {
      required: env.WS_AUTH_REQUIRED,
      tokenExpiry: env.WS_TOKEN_EXPIRY,
      secret: env.WS_TOKEN_SECRET,
    },
    rateLimit: {
      max: env.WS_RATE_LIMIT_MAX,
      window: env.WS_RATE_LIMIT_WINDOW,
    },
  };
  const pairingConfig = {
    codeLength: env.WS_PAIRING_CODE_LENGTH,
    codeExpiryMs: env.WS_PAIRING_CODE_EXPIRY_MS,
    maxPendingRequests: env.WS_PAIRING_MAX_PENDING,
    defaultTokenExpiryMs: env.WS_PAIRING_TOKEN_EXPIRY_MS,
    requireAdminApproval: env.WS_PAIRING_REQUIRE_ADMIN,
  };

  // Initialize database if a DB backend is configured.
  let dbAdapter: DatabaseAdapter | undefined;
  let jobsRepo: JobsStore | undefined;
  let jobRunsRepo: JobRunsStore | undefined;
  let sessionsRepo: SessionsStore | undefined;
  let pairingRequestsRepo: PairingRequestsStore | undefined;
  let devicesRepo: DevicesStore | undefined;
  let accessTokensRepo: AccessTokensStore | undefined;
  let scheduler: SchedulerService | undefined;

  const dbConfig =
    env.DB_KIND === 'postgres'
      ? { kind: 'postgres' as const, connectionString: env.DATABASE_URL! }
      : env.DB_KIND === 'sqlite'
        ? { kind: 'sqlite' as const, sqlitePath: env.SQLITE_PATH! }
        : undefined;

  if (dbConfig) {
    dbAdapter = await createDatabaseAdapter(dbConfig);
    jobsRepo = dbAdapter.repositories.jobs;
    jobRunsRepo = dbAdapter.repositories.jobRuns;
    sessionsRepo = dbAdapter.repositories.sessions;
    pairingRequestsRepo = dbAdapter.repositories.pairingRequests;
    devicesRepo = dbAdapter.repositories.devices;
    accessTokensRepo = dbAdapter.repositories.accessTokens;
  }

  // Create shared services once per app instance
  const providerServices = createProviderServices();
  const agentRegistry = createAgentRegistry({
    initialAgents: [],
    configPath: env.APP_CONFIG_PATH,
  });
  // Seed default skills from config/skills to .openaidy/skills.
  // Uses a manifest to track what was seeded so app updates propagate
  // only when the user has not modified their local copy.
  const skillsSourceDir = path.join(
    path.dirname(env.OPENAIDY_HOME),
    'config',
    'skills',
  );
  seedBundledSkills(skillsSourceDir, env.SKILLS_DIR);

  const skillRegistry = createSkillRegistry({ skillsDir: env.SKILLS_DIR });
  skillRegistry.load();

  const configService = createAppConfigService({
    configPath: env.APP_CONFIG_PATH,
    templatePath: env.APP_CONFIG_TEMPLATE_PATH,
    providers: providerServices,
    agents: agentRegistry,
  });
  await configService.load();

  // Create MCP client service (before sessionService so it can be injected)
  const mcpService = createMcpClientService({ logger: app.log });

  // Create workspace service before sessionService so it can be injected into builtin tools
  const workspaceService = createWorkspaceService({
    baseDir: env.WORKSPACE_BASE_DIR,
  });

  const personalityService = createAgentPersonalityService({
    workspaceBaseDir: env.WORKSPACE_BASE_DIR,
  });

  const execService = createExecService();

  // Create AddonService early so it can be injected into the builtin tool registry
  const addonManifestValidator = new ManifestValidator();
  const openAidyVersion = process.env.npm_package_version ?? '0.0.0';
  const addonService = dbAdapter
    ? createAddonService({
        repository: dbAdapter.repositories.addons,
        validator: addonManifestValidator,
        jwtSecret: env.WS_TOKEN_SECRET,
        openAidyVersion,
      })
    : undefined;

  // Create builtin tool registry (native, in-process tools — separate from MCP)
  // Session tools use a lazy getter to break the circular dependency:
  //   tool registry → SessionMessageService → tool registry
  // eslint-disable-next-line prefer-const -- must be 'let' due to forward reference in sessions getter
  let sessionService: SessionMessageService | undefined;

  const builtinToolRegistry = createBuiltinToolRegistry({
    workspace: workspaceService,
    exec: execService,
    skills: { registry: skillRegistry },
    addons: {
      addonsDir: path.join(env.OPENAIDY_HOME, 'addons'),
      ...(addonService ? { addonService } : {}),
    },
    agents: {
      registry: agentRegistry,
      getSessionService: () => sessionService!,
    },
    web: true,
    sessions: { getSessionService: () => sessionService! },
  });

  // Create run event emitter for SSE streaming (needed by sessionService)
  const runEvents = new RunEventEmitter();

  sessionService = new SessionMessageService({
    providers: providerServices,
    logger: app.log,
    agents: agentRegistry,
    mcp: mcpService,
    builtinTools: builtinToolRegistry,
    skills: skillRegistry,
    personality: personalityService,
    getDefaultAgentId: () => configService.getConfig().defaults.agentId,
    runEvents,
    workspaceBaseDir: env.WORKSPACE_BASE_DIR,
    repositories: dbAdapter
      ? {
          sessions: dbAdapter.repositories.sessions,
          messages: dbAdapter.repositories.sessionMessages,
          runs: dbAdapter.repositories.sessionRuns,
        }
      : undefined,
  });

  // Create and wire channel registry
  const channelRegistry = createChannelRegistry(
    configService.getConfig().channels,
    {
      sessionService,
      authBaseDir: path.join(env.OPENAIDY_HOME, 'channels'),
      logger: app.log,
    },
  );

  // Auto-connect enabled channels (non-blocking)
  for (const channel of channelRegistry.getAll()) {
    const cfg = configService
      .getConfig()
      .channels?.find((c) => c.id === channel.id);
    if (cfg?.enabled) {
      channel
        .connect()
        .catch((err) =>
          app.log.warn(
            { err, channelId: channel.id },
            'channel auto-connect failed on startup',
          ),
        );
    }
  }
  const bootstrapAdmin = env.BOOTSTRAP_ADMIN_ENABLED
    ? new BootstrapAdminManager(new AuthMiddleware(wsConfig), app.log, {
        enabled: env.BOOTSTRAP_ADMIN_ENABLED,
        tokenPath: env.BOOTSTRAP_ADMIN_TOKEN_PATH,
        clientId: env.BOOTSTRAP_ADMIN_CLIENT_ID,
        tokenExpiryMs: env.BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS,
      })
    : undefined;

  await bootstrapAdmin?.ensureToken();

  // Create scheduler service if database is available
  if (dbAdapter && jobsRepo && jobRunsRepo && sessionsRepo) {
    scheduler = createSchedulerService(
      jobsRepo,
      jobRunsRepo,
      sessionService,
      sessionsRepo,
      app.log,
      { pollIntervalMs: 5000 },
    );
  }

  const services: AppServices = {
    config: configService,
    providers: providerServices,
    sessions: sessionService,
    agents: agentRegistry,
    runEvents,
    bootstrapAdmin,
    dbAdapter,
    scheduler,
    jobsRepo,
    jobRunsRepo,
    sessionsRepo,
    pairingRequestsRepo,
    devicesRepo,
    accessTokensRepo,
    workspace: workspaceService,
    mcpService,
    skills: skillRegistry,
    personality: personalityService,
    channels: channelRegistry,
  };

  // Decorate the app with services for access in routes/plugins
  app.decorate('services', services);

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });
  await app.register(sensible);
  await app.register(websocket);

  // Register WebSocket gateway
  await app.register(websocketGatewayPlugin, {
    enabled: env.WS_ENABLED,
    wsConfig,
    pairingConfig,
  });

  const authMiddleware = new AuthMiddleware(wsConfig);

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    authMiddleware,
    ...(services.accessTokensRepo
      ? {
          accessTokenService: createAccessTokenService(
            services.accessTokensRepo,
          ),
        }
      : {}),
  });

  await app.register(configRoutes, {
    configService: services.config,
    authMiddleware,
  });

  // Pass shared services to session routes
  await app.register(sessionRoutes, {
    sessionService: services.sessions,
    authMiddleware,
  });

  // Pass shared services to provider routes
  await app.register(providerRoutes, {
    services: services.providers,
    authMiddleware,
  });

  // Register agent routes
  await app.register(agentRoutes, {
    agentRegistry: services.agents,
    personalityService: services.personality,
    authMiddleware,
  });

  // Register skill routes
  await app.register(skillRoutes, {
    skillRegistry: services.skills,
    agentRegistry: services.agents,
    authMiddleware,
    workspace: services.workspace,
    skillsDir: env.SKILLS_DIR,
  });

  // Register builtin tool routes
  await app.register(toolRoutes, {
    builtinTools: builtinToolRegistry,
    authMiddleware,
  });

  // Register run stream routes (SSE)
  await app.register(runStreamRoutes, {
    runEvents: services.runEvents,
    authMiddleware,
  });

  // Register scheduler routes (if database is available)
  if (
    services.scheduler &&
    services.jobsRepo &&
    services.jobRunsRepo &&
    services.sessionsRepo
  ) {
    await app.register(schedulerRoutes, {
      schedulerService: services.scheduler,
      jobsRepo: services.jobsRepo,
      jobRunsRepo: services.jobRunsRepo,
      sessionsRepo: services.sessionsRepo,
      authMiddleware,
    });
  }

  // Register pulse routes (if database is available)
  if (
    services.scheduler &&
    services.jobsRepo &&
    services.jobRunsRepo &&
    services.sessionsRepo
  ) {
    await app.register(pulseRoutes, {
      schedulerService: services.scheduler,
      jobsRepo: services.jobsRepo,
      jobRunsRepo: services.jobRunsRepo,
      sessionsRepo: services.sessionsRepo,
      authMiddleware,
    });
  }

  // Register workspace routes
  await app.register(workspaceRoutes, {
    agentRegistry: services.agents,
    workspaceService: services.workspace,
    workspaceBaseDir: env.WORKSPACE_BASE_DIR,
    authMiddleware,
  });

  // Register log routes
  await app.register(logRoutes);

  // Register task routes (requires DB)
  if (dbAdapter) {
    // Create planning service for task decomposition
    const planningService = createPlanningService({
      providers: providerServices,
      tasksRepo: dbAdapter.repositories.tasks,
      subtasksRepo: dbAdapter.repositories.subtasks,
      taskAgentsRepo: dbAdapter.repositories.taskAgents,
      agents: services.agents,
      getDefaultAgentId: () => configService.getConfig().defaults.agentId,
    });

    const taskService = createTaskService({
      tasksRepo: dbAdapter.repositories.tasks,
      subtasksRepo: dbAdapter.repositories.subtasks,
      taskAgentsRepo: dbAdapter.repositories.taskAgents,
      agents: services.agents,
      sessionService: services.sessions,
      planningService,
      runEvents: services.runEvents,
    });
    await app.register(taskRoutes, {
      taskService,
      planningService,
      authMiddleware,
    });
  }

  // Register access token routes (requires DB, admin auth enforced)
  if (services.accessTokensRepo) {
    await app.register(accessTokenRoutes, {
      accessTokenService: createAccessTokenService(services.accessTokensRepo),
      authMiddleware,
    });
  }

  // Register addon routes (requires DB)
  if (dbAdapter && addonService) {
    await app.register(addonRoutes, {
      addonsRepository: dbAdapter.repositories.addons,
      authMiddleware,
      jwtSecret: env.WS_TOKEN_SECRET,
      openAidyVersion,
      manifestValidator: addonManifestValidator,
    });
    await app.register(addonProxyRoutes, {
      addonService,
      authMiddleware,
      internalApiBaseUrl: `http://${env.HOST}:${env.PORT}`,
      sessionService,
      agentRegistry,
    });
  }

  // Register MCP routes (config CRUD + runtime connect/disconnect)
  await app.register(
    createMcpRoutesPlugin({ mcpService, configService, authMiddleware }),
  );

  // Register channel routes
  await app.register(channelRoutes, {
    channelRegistry: services.channels,
    authMiddleware,
  });

  // Start scheduler after server is ready
  app.addHook('onReady', async () => {
    if (scheduler) {
      // Recover any stuck jobs from previous run
      await scheduler.recoverStuckJobs();
      scheduler.start();
      app.log.info('Scheduler started');
    }

    // Auto-connect MCP servers from config
    const mcpServers = configService.getMcpServers();
    for (const serverConfig of mcpServers) {
      try {
        await mcpService.connect(serverConfig);
        app.log.info({ serverId: serverConfig.id }, 'MCP server connected');
      } catch (err) {
        app.log.warn(
          { serverId: serverConfig.id, err },
          'Failed to connect MCP server on startup',
        );
      }
    }
  });

  // Clean up on close
  app.addHook('onClose', async () => {
    if (scheduler) {
      await scheduler.stop();
      app.log.info('Scheduler stopped');
    }
    if (dbAdapter) {
      await dbAdapter.close();
    }
  });

  return app;
}

// Extend Fastify type for services decoration
declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}
