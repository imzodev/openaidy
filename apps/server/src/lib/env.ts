import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);
const defaultAppConfigPath = resolve(workspaceRoot, '.openaidy/openaidy.json');
const defaultAppConfigTemplatePath = resolve(
  workspaceRoot,
  'config/openaidy.template.json',
);

const envSchema = z
  .object({
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    DB_KIND: z.enum(['sqlite', 'postgres']).default('sqlite'),
    DATABASE_URL: z.string().optional(),
    SQLITE_PATH: z.string().optional(),
    APP_CONFIG_PATH: z.string().default(defaultAppConfigPath),
    APP_CONFIG_TEMPLATE_PATH: z.string().default(defaultAppConfigTemplatePath),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((value, ctx) => {
    if (value.DB_KIND === 'postgres' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DB_KIND=postgres',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(source);

  if (parsed.DB_KIND === 'sqlite' && !parsed.SQLITE_PATH) {
    return {
      ...parsed,
      SQLITE_PATH: './data/openaidy.db',
    };
  }

  return parsed;
}

export const env = parseEnv(process.env);
