import { z } from 'zod';

export const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  databaseUrl: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof configSchema>;
