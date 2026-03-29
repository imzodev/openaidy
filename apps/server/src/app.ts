import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import {
  type DatabaseAdapter,
  type JobsStore,
  type JobRunsStore,
  type SessionsStore,
  createDatabaseAdapter,
} from '@openaidy/db';
import { env } from './lib/env';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import { sessionRoutes } from './routes/sessions';
import { configRoutes } from './routes/config';
import { providerRoutes } from './routes/providers';
import { agentRoutes } from './routes/agents';
import { runStreamRoutes } from './routes/runs';
import { schedulerRoutes } from './routes/scheduler';
import { createProviderServices, type ProviderServices } from './providers';
import { SessionMessageService } from './sessions/service';
import { createAgentRegistry, type AgentRegistry } from './agents';
import { RunEventEmitter } from './dispatch';
import { SchedulerService, createSchedulerService } from './scheduler';
import {
  createAppConfigService,
  type AppConfigService,
} from './config/service';
import { websocketGatewayPlugin, type WebSocketGateway } from './websocket';

/**
 * Application services container
 *
 * These services are created once per app instance and shared across
 * all routes and plugins. This ensures that provider registration,
 * selection, and invocation all operate on the same service graph.
 */
export type AppServices = {
  config: AppConfigService;
  providers: ProviderServices;
  sessions: SessionMessageService;
  agents: AgentRegistry;
  runEvents: RunEventEmitter;
  dbAdapter: DatabaseAdapter | undefined;
  scheduler: SchedulerService | undefined;
  jobsRepo: JobsStore | undefined;
  jobRunsRepo: JobRunsStore | undefined;
  sessionsRepo: SessionsStore | undefined;
};

/**
 * Build the Fastify application with unified service lifecycle
 */
export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });

  // Initialize database if a DB backend is configured.
  let dbAdapter: DatabaseAdapter | undefined;
  let jobsRepo: JobsStore | undefined;
  let jobRunsRepo: JobRunsStore | undefined;
  let sessionsRepo: SessionsStore | undefined;
  let scheduler: SchedulerService | undefined;

  const dbConfig =
    env.DB_KIND === 'postgres'
      ? { kind: 'postgres' as const, connectionString: env.DATABASE_URL! }
      : env.DB_KIND === 'sqlite'
        ? { kind: 'sqlite' as const, sqlitePath: env.SQLITE_PATH! }
        : undefined;

  if (dbConfig) {
    dbAdapter = createDatabaseAdapter(dbConfig);
    jobsRepo = dbAdapter.repositories.jobs;
    jobRunsRepo = dbAdapter.repositories.jobRuns;
    sessionsRepo = dbAdapter.repositories.sessions;
  }

  // Create shared services once per app instance
  const providerServices = createProviderServices();
  const agentRegistry = createAgentRegistry({ initialAgents: [] });
  const configService = createAppConfigService({
    configPath: env.APP_CONFIG_PATH,
    templatePath: env.APP_CONFIG_TEMPLATE_PATH,
    providers: providerServices,
    agents: agentRegistry,
  });
  await configService.load();

  const sessionService = new SessionMessageService({
    providers: providerServices,
    agents: agentRegistry,
    getDefaultAgentId: () => configService.getConfig().defaults.agentId,
    repositories: dbAdapter
      ? {
          sessions: dbAdapter.repositories.sessions,
          messages: dbAdapter.repositories.sessionMessages,
          runs: dbAdapter.repositories.sessionRuns,
        }
      : undefined,
  });

  // Create run event emitter for SSE streaming
  const runEvents = new RunEventEmitter();

  // Create scheduler service if database is available
  if (dbAdapter && jobsRepo && jobRunsRepo) {
    scheduler = createSchedulerService(
      jobsRepo,
      jobRunsRepo,
      sessionService,
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
    dbAdapter,
    scheduler,
    jobsRepo,
    jobRunsRepo,
    sessionsRepo,
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
    wsConfig: {
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
    },
    pairingConfig: {
      codeLength: env.WS_PAIRING_CODE_LENGTH,
      codeExpiryMs: env.WS_PAIRING_CODE_EXPIRY_MS,
      maxPendingRequests: env.WS_PAIRING_MAX_PENDING,
      defaultTokenExpiryMs: env.WS_PAIRING_TOKEN_EXPIRY_MS,
      requireAdminApproval: env.WS_PAIRING_REQUIRE_ADMIN,
    },
  });

  await app.register(healthRoutes);

  await app.register(configRoutes, { configService: services.config });

  // Pass shared services to session routes
  await app.register(sessionRoutes, { sessionService: services.sessions });

  // Pass shared services to provider routes
  await app.register(providerRoutes, { services: services.providers });

  // Register agent routes
  await app.register(agentRoutes, { agentRegistry: services.agents });

  // Register run stream routes (SSE)
  await app.register(runStreamRoutes, { runEvents: services.runEvents });

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
    });
  }

  // Start scheduler after server is ready
  app.addHook('onReady', async () => {
    if (scheduler) {
      // Recover any stuck jobs from previous run
      await scheduler.recoverStuckJobs();
      scheduler.start();
      app.log.info('Scheduler started');
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
