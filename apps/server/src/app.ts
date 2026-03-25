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
import { providerRoutes } from './routes/providers';
import { agentRoutes } from './routes/agents';
import { runStreamRoutes } from './routes/runs';
import { schedulerRoutes } from './routes/scheduler';
import { createProviderServices, type ProviderServices } from './providers';
import { SessionMessageService } from './sessions/service';
import { createAgentRegistry, type AgentRegistry } from './agents';
import { RunEventEmitter } from './dispatch';
import { SchedulerService, createSchedulerService } from './scheduler';

/**
 * Application services container
 * 
 * These services are created once per app instance and shared across
 * all routes and plugins. This ensures that provider registration,
 * selection, and invocation all operate on the same service graph.
 */
export type AppServices = {
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
  
  const dbConfig = env.DB_KIND === 'postgres'
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
  const sessionService = new SessionMessageService({
    providers: providerServices,
    repositories: dbAdapter
      ? {
          sessions: dbAdapter.repositories.sessions,
          messages: dbAdapter.repositories.sessionMessages,
          runs: dbAdapter.repositories.sessionRuns,
        }
      : undefined,
  });
  
  // Create agent registry
  const agentRegistry = createAgentRegistry();
  
  // Create run event emitter for SSE streaming
  const runEvents = new RunEventEmitter();
  
  // Create scheduler service if database is available
  if (dbAdapter && jobsRepo && jobRunsRepo) {
    scheduler = createSchedulerService(
      jobsRepo,
      jobRunsRepo,
      sessionService,
      app.log,
      { pollIntervalMs: 5000 }
    );
  }
  
  const services: AppServices = {
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

  await app.register(cors, { origin: env.CORS_ORIGIN });
  await app.register(sensible);
  await app.register(websocket);

  await app.register(healthRoutes);
  
  // Pass shared services to session routes
  await app.register(sessionRoutes, { sessionService: services.sessions });
  
  // Pass shared services to provider routes
  await app.register(providerRoutes, { services: services.providers });
  
  // Register agent routes
  await app.register(agentRoutes, { agentRegistry: services.agents });
  
  // Register run stream routes (SSE)
  await app.register(runStreamRoutes, { runEvents: services.runEvents });
  
  // Register scheduler routes (if database is available)
  if (services.scheduler && services.jobsRepo && services.jobRunsRepo && services.sessionsRepo) {
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
