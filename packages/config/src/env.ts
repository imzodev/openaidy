import { z } from 'zod';

export const DEFAULT_SERVER_PORT = 3001 as const;

export const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  databaseUrl: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof configSchema>;
