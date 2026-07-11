import Fastify from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
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
import { createLogger, registerHttpLogger } from './lib/logger';
import {
  buildCredentialResolver,
  noopInvalidator,
} from './lib/credential-provider';
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
import { AddonStorageEngine, DEFAULT_QUOTAS } from './addons/storage/engine';
import { ManifestValidator } from './addons/manifest-validator';
import { createAddonService } from './addons/service';
import { taskRoutes } from './routes/tasks';
import { taskScheduleRoutes } from './routes/task-schedules';
import { createTaskService } from './tasks';
import { createPlanningService } from './planning';
import {
  TaskScheduleExecutor,
  type TaskScheduleExecutorDeps,
} from './tasks/execution/task-schedule-executor';
import { TaskScheduleService } from './tasks/schedule-service';
import {
  RecurringTasksService,
  createRecurringTasksService,
} from './recurring';
import { createMcpClientService } from './mcp/client';
import { createProviderServices } from './providers';
import { SessionMessageService } from './sessions/service';
import { createAgentRegistry } from './agents';
import { RunEventEmitter } from './dispatch';
import {
  SchedulerService,
  createSchedulerService,
  calculateNextRun,
  createPulseRunnableAdapter,
} from './scheduler';
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
import { PulseService } from './pulses/service.js';
import { channelRoutes } from './routes/channels.js';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { AppServices } from './types';

/**
 * Build the Fastify application with unified service lifecycle
 */
export async function buildApp() {
  const app = Fastify({ logger: false });
  const log = createLogger();
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

    // Backfill sessions_fts index for any pre-existing sessions
    const { indexed } =
      await dbAdapter.repositories.sessions.backfillFtsIndex();
    if (indexed > 0) {
      log.info(`Indexed ${indexed} pre-existing sessions into sessions_fts`);
    }

    // Backfill session_messages_fts index for any pre-existing messages
    const { indexed: msgIndexed } =
      await dbAdapter.repositories.sessions.backfillMessagesFtsIndex();
    if (msgIndexed > 0) {
      log.info(
        `Indexed ${msgIndexed} pre-existing session messages into session_messages_fts`,
      );
    }
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

  const credentialResolver = buildCredentialResolver(
    dbAdapter ? (dbAdapter.client as never) : undefined,
  );
  const invalidateCredential = credentialResolver
    ? credentialResolver.invalidate
    : noopInvalidator();

  const configService = createAppConfigService({
    configPath: env.APP_CONFIG_PATH,
    templatePath: env.APP_CONFIG_TEMPLATE_PATH,
    providers: providerServices,
    agents: agentRegistry,
    ...(credentialResolver ? { credentialProvider: credentialResolver } : {}),
  });
  await configService.load();

  // Reconcile preinstalled MCP servers from the config template: add ones this
  // install is missing and update pristine (unmodified) ones whose definition
  // changed, so template changes reach existing installs, not just fresh ones.
  // User-created/edited servers and ones the user deleted are left alone.
  // Wrapped so a config-dir write failure (read-only mount, ENOSPC, EACCES)
  // logs and continues rather than aborting startup — seeding is best-effort.
  try {
    const mcpReconcile = await configService.reconcilePreinstalledMcpServers();
    if (mcpReconcile.added.length > 0 || mcpReconcile.updated.length > 0) {
      log.info('Reconciled preinstalled MCP server(s) from config template', {
        added: mcpReconcile.added,
        updated: mcpReconcile.updated,
      });
    }
  } catch (err) {
    log.warn('Failed to reconcile preinstalled MCP servers; continuing', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Create MCP client service (before sessionService so it can be injected)
  const mcpService = createMcpClientService({
    logger: log as unknown as FastifyBaseLogger,
  });

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

  // Per-addon SQLite storage engine (lazy connections; shared by the addon
  // proxy routes and the uninstall cleanup path).
  const addonStorageEngine = new AddonStorageEngine(
    path.join(env.OPENAIDY_HOME, 'addons'),
    DEFAULT_QUOTAS,
    { warn: (message, meta) => log.warn(message, meta) },
  );

  // Create builtin tool registry (native, in-process tools — separate from MCP)
  // Session tools and Tasks tools use lazy getters to break circular dependencies:
  //   tool registry → SessionMessageService → tool registry
  //   tool registry → TaskService → SessionMessageService → tool registry
  // eslint-disable-next-line prefer-const -- must be 'let' due to forward reference in getters
  let sessionService: SessionMessageService | undefined;

  let taskService: ReturnType<typeof createTaskService> | undefined;
  let recurringTasksService: RecurringTasksService | undefined;
  let taskScheduleService: TaskScheduleService | undefined;

  let planningService: ReturnType<typeof createPlanningService> | undefined;

  const builtinToolRegistry = createBuiltinToolRegistry({
    workspace: workspaceService,
    exec: execService,
    skills: { registry: skillRegistry },
    addons: {
      addonsDir: path.join(env.OPENAIDY_HOME, 'addons'),
      storageEngine: addonStorageEngine,
      ...(addonService ? { addonService } : {}),
    },
    agents: {
      registry: agentRegistry,
      getSessionService: () => sessionService!,
    },
    web: true,
    sessions: { getSessionService: () => sessionService! },
    ...(dbAdapter
      ? {
          memory: {
            memoriesRepo: dbAdapter.repositories.memories,
            sessionsRepo: dbAdapter.repositories.sessions,
            defaultAgentId: configService.getConfig().defaults.agentId,
            createLogger,
          },
          pulses: {
            getJobsRepo: () => dbAdapter!.repositories.jobs,
            getSessionsRepo: () => dbAdapter!.repositories.sessions,
            getPulseService: () =>
              new PulseService(
                dbAdapter!.repositories.jobs,
                dbAdapter!.repositories.jobRuns,
                dbAdapter!.repositories.sessions,
              ),
          },
        }
      : {}),
    getTaskService: () => taskService,
    getPlanningService: () => planningService,
    // The schedule service is constructed later (when dbAdapter +
    // RECURRING_TASKS_ENABLED are both available), so this getter
    // returns `undefined` at registry construction time. The tools
    // it produces check for `undefined` at execute time and return
    // a friendly error if the service is missing.
    getTaskScheduleService: () => taskScheduleService,
  });

  // Create run event emitter for SSE streaming (needed by sessionService)
  const runEvents = new RunEventEmitter();

  sessionService = new SessionMessageService({
    providers: providerServices,
    logger: log as unknown as FastifyBaseLogger,
    agents: agentRegistry,
    mcp: mcpService,
    workspace: workspaceService,
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
      logger: log as unknown as FastifyBaseLogger,
    },
  );

  // Auto-connect enabled channels (non-blocking)
  for (const channel of channelRegistry.getAll()) {
    const cfg = configService
      .getConfig()
      .channels?.find((c) => c.id === channel.id);
    if (cfg?.enabled) {
      channel.connect().catch((err) =>
        log.warn('channel auto-connect failed on startup', {
          err,
          channelId: channel.id,
        }),
      );
    }
  }
  const bootstrapAdmin = env.BOOTSTRAP_ADMIN_ENABLED
    ? new BootstrapAdminManager(
        new AuthMiddleware(wsConfig),
        log as unknown as FastifyBaseLogger,
        {
          enabled: env.BOOTSTRAP_ADMIN_ENABLED,
          tokenPath: env.BOOTSTRAP_ADMIN_TOKEN_PATH,
          clientId: env.BOOTSTRAP_ADMIN_CLIENT_ID,
          tokenExpiryMs: env.BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS,
        },
      )
    : undefined;

  await bootstrapAdmin?.ensureToken();

  // Create scheduler service if database is available
  if (dbAdapter && jobsRepo && jobRunsRepo && sessionsRepo) {
    scheduler = createSchedulerService(
      jobsRepo,
      jobRunsRepo,
      sessionService,
      sessionsRepo,
      log as unknown as FastifyBaseLogger,
      { pollIntervalMs: 5000 },
    );

    // Register the PulseRunnableAdapter. Pulses are now driven
    // by the same `ScheduledRunnable` contract as recurring tasks.
    // Order matters: pulse is registered first so that when both
    // a pulse and a recurring task are due at the same time, the
    // pulse wins (preserves the pre-migration dispatch priority).
    scheduler.registerRunnable(
      createPulseRunnableAdapter({
        jobsRepo,
        jobRunsRepo,
        sessionsStore: sessionsRepo,
        sessionMessageService: sessionService,
        logger: log as unknown as FastifyBaseLogger,
      }),
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
    taskSchedules: undefined,
  };

  // Decorate the app with services for access in routes/plugins
  app.decorate('services', services);

  await app.register(cors, {
    // Allow the configured dev origin AND `null` — sandboxed iframes
    // (addon UI uses `sandbox="allow-scripts allow-forms"` without
    // `allow-same-origin`) send Origin: null and would otherwise be
    // rejected. The /api routes still require a valid auth token, so
    // allowing null origin here doesn't open CSRF holes for state-
    // changing endpoints.
    origin: [env.CORS_ORIGIN, 'null'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });
  await app.register(sensible);
  await app.register(websocket);

  // HTTP request logging using our single logger
  registerHttpLogger(app);

  // Register WebSocket gateway
  await app.register(websocketGatewayPlugin, {
    enabled: env.WS_ENABLED,
    wsConfig,
    pairingConfig,
  });

  const authMiddleware = new AuthMiddleware(wsConfig);

  await app.register(healthRoutes);

  // All REST routes share the `/api` prefix. Wrapping them in a Fastify
  // scope with `prefix: '/api'` means each route file can use bare paths
  // (`/sessions`, `/tasks`, `/channels`, ...) and the prefix is applied
  // once at registration time — no per-route duplication, no risk of a
  // new route forgetting the prefix. `healthRoutes` and `fastifyStatic`
  // stay outside this scope because they're not part of the API surface.
  await app.register(
    async (api) => {
      await api.register(authRoutes, {
        authMiddleware,
        ...(services.accessTokensRepo
          ? {
              accessTokenService: createAccessTokenService(
                services.accessTokensRepo,
              ),
            }
          : {}),
      });

      await api.register(configRoutes, {
        configService: services.config,
        authMiddleware,
      });

      // Pass shared services to session routes
      await api.register(sessionRoutes, {
        sessionService: services.sessions,
        authMiddleware,
      });

      // Pass shared services to provider routes. provider routes may
      // optionally use the DB (for OAuth state + provider credentials);
      // when the adapter isn't available, pass undefined and the routes
      // skip the OAuth/connection endpoints.
      await api.register(providerRoutes, {
        services: services.providers,
        authMiddleware,
        // When a DB is configured, pass the raw drizzle instance
        // (dbAdapter.client) — the only thing with .insert/.select/.update.
        // With DB_KIND=disabled there is no adapter; provider routes accept
        // `db: undefined` and skip the OAuth/connection endpoints that need it.
        ...(dbAdapter
          ? { db: dbAdapter.client as import('@openaidy/db').DatabaseClient }
          : {}),
        invalidateCredential,
      });

      // Register agent routes
      await api.register(agentRoutes, {
        agentRegistry: services.agents,
        personalityService: services.personality,
        authMiddleware,
      });

      // Register skill routes
      await api.register(skillRoutes, {
        skillRegistry: services.skills,
        agentRegistry: services.agents,
        authMiddleware,
        workspace: services.workspace,
        skillsDir: env.SKILLS_DIR,
      });

      // Register builtin tool routes
      await api.register(toolRoutes, {
        builtinTools: builtinToolRegistry,
        authMiddleware,
      });

      // Register run stream routes (SSE)
      await api.register(runStreamRoutes, {
        runEvents: services.runEvents,
        authMiddleware,
      });

      // Register scheduler routes (if database is available)
      if (services.jobsRepo && services.jobRunsRepo && services.sessionsRepo) {
        await api.register(schedulerRoutes, {
          jobsRepo: services.jobsRepo,
          jobRunsRepo: services.jobRunsRepo,
          sessionsRepo: services.sessionsRepo,
          authMiddleware,
        });
      }

      // Register pulse routes (if database is available)
      if (
        services.sessions &&
        services.jobsRepo &&
        services.jobRunsRepo &&
        services.sessionsRepo
      ) {
        await api.register(pulseRoutes, {
          jobsRepo: services.jobsRepo,
          jobRunsRepo: services.jobRunsRepo,
          sessionsRepo: services.sessionsRepo,
          sessionMessageService: services.sessions,
          authMiddleware,
        });
      }

      // Register workspace routes
      await api.register(workspaceRoutes, {
        agentRegistry: services.agents,
        workspaceService: services.workspace,
        workspaceBaseDir: env.WORKSPACE_BASE_DIR,
        authMiddleware,
      });

      // Register log routes
      await api.register(logRoutes, { authMiddleware });

      // Register task routes (requires DB)
      if (dbAdapter) {
        planningService = createPlanningService({
          providers: providerServices,
          tasksRepo: dbAdapter.repositories.tasks,
          subtasksRepo: dbAdapter.repositories.subtasks,
          taskAgentsRepo: dbAdapter.repositories.taskAgents,
          deliverablesRepo: dbAdapter.repositories.deliverables,
          agents: services.agents,
          getDefaultAgentId: () => configService.getConfig().defaults.agentId,
        });

        taskService = createTaskService({
          tasksRepo: dbAdapter.repositories.tasks,
          subtasksRepo: dbAdapter.repositories.subtasks,
          taskAgentsRepo: dbAdapter.repositories.taskAgents,
          deliverablesRepo: dbAdapter.repositories.deliverables,
          taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
          agents: services.agents,
          sessionService: services.sessions,
          planningService,
          runEvents: services.runEvents,
          workspaceBaseDir: env.WORKSPACE_BASE_DIR,
        });
        await api.register(taskRoutes, {
          taskService,
          planningService,
          deliverablesRepo: dbAdapter.repositories.deliverables,
          authMiddleware,
        });

        // Duck-typed adapter: SessionMessageService is structurally compatible
        // with the executor's narrower ExecutorSessionService, but TS's
        // exactOptionalPropertyTypes on onStreamEvent makes the subtype
        // check fail. The cast is safe because the executor never sets
        // onStreamEvent (it would be a no-op).
        const sessionServiceForExecutor =
          services.sessions as unknown as import('./tasks/execution/task-schedule-executor').ExecutorSessionService;
        const executorDeps: TaskScheduleExecutorDeps = {
          tasksRepo: dbAdapter.repositories.tasks,
          subtasksRepo: dbAdapter.repositories.subtasks,
          taskAgentsRepo: dbAdapter.repositories.taskAgents,
          taskSchedulesRepo: dbAdapter.repositories.taskSchedules,
          taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
          taskService: {
            executeTask: (taskId, options) =>
              taskService!.executeTask(taskId, options),
            executeSubtasks: (taskId) => taskService!.executeSubtasks(taskId),
          },
          sessionService: sessionServiceForExecutor,
          defaultAgentIdProvider: () =>
            configService.getConfig().defaults.agentId,
          calculateNextRun: (cron, now) => calculateNextRun(cron, now),
          logger: log as unknown as TaskScheduleExecutorDeps['logger'],
          // planningService is omitted when planning isn't configured; the
          // executor falls back to a warning + the description-execution
          // path. The optional key works with exactOptionalPropertyTypes
          // because we only add the field when it has a real value.
          ...(planningService
            ? {
                planningService: {
                  planTask: (taskId: string) =>
                    planningService!.planTask(taskId),
                },
              }
            : {}),
        };
        const taskScheduleExecutor = new TaskScheduleExecutor(executorDeps);

        // Note: `taskScheduleService` is declared in the outer scope (a `let`
        // with `| undefined`) so that the schedule routes can be wired
        // up here without depending on the feature flag. The service
        // is only instantiated when RECURRING_TASKS_ENABLED is on; the
        // routes only get registered if the service is set.
        taskScheduleService = new TaskScheduleService({
          tasksRepo: dbAdapter.repositories.tasks,
          taskSchedulesRepo: dbAdapter.repositories.taskSchedules,
          taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
          taskScheduleExecutor,
        });
        services.taskSchedules = taskScheduleService;

        // Schedule endpoints (Phase 4) — nested under /api/tasks/:taskId/schedule.
        // These give the UI a dedicated surface for CRUD + pause/resume +
        // trigger + history. The `schedule` field on POST /api/tasks is
        // still supported as a convenience for creating a task with a
        // schedule in one call.
        await api.register(taskScheduleRoutes, {
          taskScheduleService,
          authMiddleware,
        });

        // Wire the schedule service into the TaskService so that
        // createTask and getTaskWithDetails can attach schedules.
        taskService!.setTaskSchedulesService(taskScheduleService);

        // The recurring service logger is the same pino instance — the
        // GenericLogger mismatch is only in method signature shape.
        // We also wire the run-event subscription so history rows are
        // finalised (planned -> verifying -> completed/failed) when the
        // task session the executor created finishes its run.
        recurringTasksService = createRecurringTasksService({
          taskSchedulesRepo: dbAdapter.repositories.taskSchedules,
          taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
          executor: taskScheduleExecutor,
          runEvents: services.runEvents,
          // Pull the session type from the SessionsStore (or fall through
          // to a type field if it's on the record). This filters out
          // subtask and chat sessions so we only finalise history rows
          // for the top-level task runs the executor created.
          getSessionType: async (sessionId) => {
            const session =
              await dbAdapter!.repositories.sessions.findById(sessionId);
            return session && 'type' in session
              ? (session as { type?: string }).type
              : null;
          },
          logger: log as unknown as Parameters<
            typeof createRecurringTasksService
          >[0] extends infer T
            ? T extends { logger?: infer L }
              ? L
              : never
            : never,
        });
        // Phase 7: register the executor as a ScheduledRunnable on the
        // central scheduler. The scheduler's tick now drives the
        // recurring-tasks claim → execute → reschedule cycle alongside
        // (or interleaved with) the legacy Pulse path. The recurring
        // tasks service is purely an event listener + delegator now.
        if (scheduler) {
          scheduler.registerRunnable(taskScheduleExecutor);
          // Start the run-event subscription so history rows transition
          // to their terminal state when the executor's runs complete.
          recurringTasksService.start();
          log.info(
            `Recurring tasks feature enabled and running (runnables: ${scheduler.getRunnableKinds().join(', ')})`,
          );
        } else {
          // Should never happen — the recurring-tasks feature flag is
          // gated on the database being available, and so is the
          // scheduler. This branch exists only to keep the type-narrower
          // happy; if it ever runs, we have a wiring bug.
          log.error(
            'Recurring tasks feature enabled but scheduler is not initialised — skipping runnable registration',
          );
          recurringTasksService.start();
        }
      }

      // Register access token routes (requires DB, admin auth enforced)
      if (services.accessTokensRepo) {
        await api.register(accessTokenRoutes, {
          accessTokenService: createAccessTokenService(
            services.accessTokensRepo,
          ),
          authMiddleware,
        });
      }

      // Register MCP routes (config CRUD + runtime connect/disconnect)
      await api.register(
        createMcpRoutesPlugin({ mcpService, configService, authMiddleware }),
      );

      // Register channel routes
      await api.register(channelRoutes, {
        channelRegistry: services.channels,
        authMiddleware,
      });

      // Register addon proxy routes inside the /api scope (their paths
      // are relative — `/addon-proxy/...` — and rely on the prefix).
      if (addonService) {
        await api.register(addonProxyRoutes, {
          addonService,
          authMiddleware,
          internalApiBaseUrl: `http://${env.HOST}:${env.PORT}`,
          sessionService,
          agentRegistry,
          storageEngine: addonStorageEngine,
        });
      }
    },
    { prefix: '/api' },
  );

  // ==========================================================================
  // Web bundle (same-origin: server serves the built web UI)
  // ==========================================================================
  //
  // Register addon routes (requires DB) at the outer app level — not
  // inside the /api scope callback. Fastify's encapsulation model means
  // `app.register()` from within a child plugin's context has ordering
  // quirks that can leave routes registered AFTER a certain point
  // invisible on the outer app. By registering `addonRoutes` as a
  // sibling of the /api scope, every route in the plugin (the /api/*
  // CRUD endpoints, the /sdk static asset, AND the /addons/:addonId/*
  // static file handler) is exposed correctly. The plugin uses absolute
  // paths so it doesn't need to live under /api.
  //
  // `addonProxyRoutes` stays inside the /api scope because its paths
  // are relative (`/addon-proxy/...`) and rely on the prefix.
  if (dbAdapter && addonService) {
    await app.register(addonRoutes, {
      addonsRepository: dbAdapter.repositories.addons,
      authMiddleware,
      jwtSecret: env.WS_TOKEN_SECRET,
      openAidyVersion,
      manifestValidator: addonManifestValidator,
      storageEngine: addonStorageEngine,
    });
  }

  // Resolve the web dist path from OPENAIDY_WEB_DIST, falling back to
  // ${OPENAIDY_REPO}/apps/web/dist. Web serving is opt-in: when neither
  // var is set the server only exposes the API + WS — this is what lets
  // the existing test suite boot the app without a built bundle. When a
  // path IS resolved we validate index.html exists and fail loud (rather
  // than silently serving from a wrong directory).
  //
  // CLI's `openaidy start --integrated` builds the web bundle first and
  // passes OPENAIDY_WEB_DIST explicitly; for direct server startups
  // OPENAIDY_REPO is set by install scripts.
  const webDistPath = resolveWebDistPath(
    process.env.OPENAIDY_WEB_DIST,
    process.env.OPENAIDY_REPO,
  );
  if (webDistPath) {
    try {
      await access(path.join(webDistPath, 'index.html'));
    } catch {
      throw new Error(
        `Web bundle not found at ${webDistPath} (missing index.html). ` +
          'Run `pnpm --filter web build` to produce it, or point ' +
          'OPENAIDY_WEB_DIST at an existing dist directory.',
      );
    }
    log.info(`Serving web bundle from ${webDistPath}`);

    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      // We attach cache headers ourselves per-asset (immutable for hashed
      // Vite assets, no-cache for index.html). Disabling the plugin's own
      // cache-control avoids double-setting the header.
      cacheControl: false,
      // Don't auto-resolve index.html for unmatched paths — we handle SPA
      // fallback via setNotFoundHandler below so /api/* keeps returning JSON.
      wildcard: false,
      decorateReply: true,
    });

    // Vite emits content-addressed assets under /assets/<hash>.<ext>.
    // Their filenames change whenever their content changes, so the
    // immutable flag is safe and lets CDNs cache them for a year.
    app.addHook('onSend', async (request, reply) => {
      if (request.url.startsWith('/assets/')) {
        void reply.header(
          'cache-control',
          'public, max-age=31536000, immutable',
        );
      }
    });

    // SPA fallback — serve index.html for client-side routes (e.g.
    // /sessions/abc) while preserving JSON 404 semantics for /api/* paths
    // so API clients never receive the HTML shell. index.html always
    // revalidates so deploys are picked up immediately.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        void reply.code(404).send({ error: 'Not found', path: request.url });
        return;
      }
      void reply.header('cache-control', 'no-cache, must-revalidate');
      return reply.sendFile('index.html');
    });
  } else {
    log.info(
      'Web bundle not configured (OPENAIDY_WEB_DIST and OPENAIDY_REPO both ' +
        'unset). Server exposes API + WS only. Pass --integrated to `openaidy ' +
        'start`, or set OPENAIDY_WEB_DIST, to serve the web UI.',
    );
  }

  // Start scheduler after server is ready
  let stuckSubtaskInterval: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', async () => {
    if (scheduler) {
      // Recover any stuck jobs from previous run
      await scheduler.recoverStuckJobs();
      scheduler.start();
      log.info('Scheduler started');
    }

    // Start periodic stuck subtask check
    if (taskService) {
      stuckSubtaskInterval = setInterval(
        () => {
          taskService!.checkStuckSubtasks().catch((err) => {
            log.error('Failed to check stuck subtasks', err);
          });
        },
        5 * 60 * 1000,
      ); // Every 5 minutes
      log.info('Stuck subtask checker started (every 5 minutes)');
    }

    // Auto-connect MCP servers from config — non-blocking. These are
    // spawned via npx, which may need to download the package on first
    // run and can take far longer than Fastify's onReady budget
    // (default 10s). Awaiting here would stall the hook and crash
    // startup with FST_ERR_HOOK_TIMEOUT. Connect in the background and
    // log the outcome; a slow or unavailable MCP server must not take
    // down the HTTP API (routes already tolerate unconnected servers).
    const mcpServers = configService.getMcpServers();
    for (const serverConfig of mcpServers) {
      // A server whose ${VAR} secrets aren't set yet (e.g. a preinstalled
      // GitHub server before the user pastes a token) isn't broken — it's
      // just awaiting configuration. Skip the connect so startup doesn't emit
      // a misleading "failed to connect" warning; it connects on demand once
      // its secrets are provided (via the connect endpoint or a restart).
      const missing = mcpService.missingSecrets(serverConfig);
      if (missing.length > 0) {
        log.info('MCP server awaiting configuration — not auto-connecting', {
          serverId: serverConfig.id,
          missing,
        });
        continue;
      }
      void (async () => {
        try {
          await mcpService.connect(serverConfig);
          log.info('MCP server connected', { serverId: serverConfig.id });
        } catch (err) {
          log.warn('Failed to connect MCP server on startup', {
            serverId: serverConfig.id,
            err,
          });
        }
      })();
    }
  });

  // Clean up on close
  app.addHook('onClose', async () => {
    if (stuckSubtaskInterval) {
      clearInterval(stuckSubtaskInterval);
      log.info('Stuck subtask checker stopped');
    }
    if (recurringTasksService) {
      await recurringTasksService.stop();
    }
    if (scheduler) {
      await scheduler.stop();
      log.info('Scheduler stopped');
    }
    if (dbAdapter) {
      await dbAdapter.close();
    }
    // Close per-addon SQLite connections (checkpoints WAL) on shutdown.
    addonStorageEngine.closeAll();
  });

  return app;
}

/**
 * Resolve the absolute path to the web bundle (apps/web/dist) the server
 * should serve. Uses OPENAIDY_WEB_DIST when set, otherwise falls back to
 * `${OPENAIDY_REPO}/apps/web/dist`. Returns undefined when neither source
 * is configured — callers must treat that as a startup error rather than
 * guessing a random directory.
 */
function resolveWebDistPath(
  webDistEnv: string | undefined,
  repoRootEnv: string | undefined,
): string | undefined {
  if (webDistEnv && webDistEnv.length > 0) {
    return path.resolve(webDistEnv);
  }
  if (repoRootEnv && repoRootEnv.length > 0) {
    return path.resolve(repoRootEnv, 'apps', 'web', 'dist');
  }
  return undefined;
}

// Extend Fastify type for services decoration and request timing
declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
  interface FastifyRequest {
    startTime?: number;
  }
}
