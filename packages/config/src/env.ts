import { z } from 'zod';

/**
 * Default server port.
 * Single source of truth for the default port value.
 * All server port configuration (HTTP and WebSocket) references this constant.
 */
export const DEFAULT_SERVER_PORT = 3001 as const;

export type DEFAULT_SERVER_PORT = typeof DEFAULT_SERVER_PORT;

export const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  databaseUrl: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof configSchema>;
