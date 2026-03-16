import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { env } from './lib/env';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import { sessionRoutes } from './routes/sessions';
import { providerRoutes } from './routes/providers';
import { createProviderServices, type ProviderServices } from './providers';
import { SessionMessageService } from './sessions/service';

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
};

/**
 * Build the Fastify application with unified service lifecycle
 */
export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });

  // Create shared services once per app instance
  const providerServices = createProviderServices();
  const sessionService = new SessionMessageService(providerServices);
  
  const services: AppServices = {
    providers: providerServices,
    sessions: sessionService,
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

  return app;
}

// Extend Fastify type for services decoration
declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}
