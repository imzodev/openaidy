import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SERVER_PORT } from '@openaidy/config';

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);
const defaultOpenAidyHome = resolve(workspaceRoot, '.openaidy');
const defaultAppConfigTemplatePath = resolve(
  workspaceRoot,
  'config/openaidy.template.json',
);
const resolveOpenAidyPath = (
  openAidyHome: string,
  relativePath: string,
): string => resolve(openAidyHome, relativePath);

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().default('0.0.0.0'),
    // Default port the HTTP server binds to. Same-origin architecture:
    // the WebSocket gateway rides on this same port (see WS_PORT alias
    // below). Override via OPENAIDY_PORT to use a different port.
    OPENAIDY_PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_SERVER_PORT),
    // Default CORS origin permits the local Vite dev server (apps/web).
    // Override for production or remote dev.
    OPENAIDY_CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    DB_KIND: z.enum(['sqlite', 'postgres']).default('sqlite'),
    DATABASE_URL: z.string().optional(),
    SQLITE_PATH: z.string().optional(),
    OPENAIDY_HOME: z.string().default(defaultOpenAidyHome),
    APP_CONFIG_PATH: z.string().optional(),
    APP_CONFIG_TEMPLATE_PATH: z.string().default(defaultAppConfigTemplatePath),
    LOG_LEVEL: z.string().default('info'),
    // WebSocket configuration
    WS_ENABLED: z
      .string()
      .transform((val) => val === 'true')
      .default('true'),
    WS_PATH: z.string().default('/ws'),
    WS_MAX_CONNECTIONS: z.coerce.number().int().positive().default(1000),
    WS_HEARTBEAT_INTERVAL: z.coerce.number().positive().default(30000),
    WS_AUTH_REQUIRED: z
      .string()
      .transform((val) => val === 'true')
      .default('true'),
    WS_TOKEN_EXPIRY: z.coerce.number().positive().default(86400000),
    WS_TOKEN_SECRET: z.string().default('change-me-in-production'),
    WS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    WS_RATE_LIMIT_WINDOW: z.coerce.number().positive().default(60000),
    // Pairing configuration
    WS_PAIRING_CODE_LENGTH: z.coerce.number().int().min(4).max(12).default(6),
    WS_PAIRING_CODE_EXPIRY_MS: z.coerce.number().positive().default(300000),
    WS_PAIRING_MAX_PENDING: z.coerce.number().int().positive().default(100),
    WS_PAIRING_TOKEN_EXPIRY_MS: z.coerce
      .number()
      .positive()
      .default(2592000000),
    WS_PAIRING_REQUIRE_ADMIN: z
      .string()
      .transform((val) => val !== 'false')
      .default('true'),
    BOOTSTRAP_ADMIN_ENABLED: z
      .string()
      .transform((val) => val !== 'false')
      .default('true'),
    BOOTSTRAP_ADMIN_TOKEN_PATH: z.string().optional(),
    BOOTSTRAP_ADMIN_CLIENT_ID: z.string().default('bootstrap-admin'),
    BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS: z.coerce
      .number()
      .positive()
      .default(31536000000),
    // Optional override for the master key used to encrypt provider
    // credentials at rest (AES-256-GCM). When unset, a unique random key is
    // generated and persisted per install (see lib/encryption.ts), so the app
    // stays zero-config. Set this for containerized/rotated/shared-key deploys.
    // Must be >= 32 chars when provided.
    CREDENTIALS_MASTER_KEY: z.string().optional(),
    // Workspace configuration
    WORKSPACE_BASE_DIR: z.string().optional(),
    // Skills configuration
    SKILLS_DIR: z.string().optional(),
    // Recurring tasks feature flag. Default: off in all envs — this is
    // a v1 feature and we're shipping behind a flag until Phase 7's
    // regression sweep. Production should explicitly opt in once the
    // integration tests pass.
    RECURRING_TASKS_ENABLED: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
  })
  .superRefine((value, ctx) => {
    if (value.DB_KIND === 'postgres' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DB_KIND=postgres',
      });
    }
  })
  .transform((value) => {
    const openAidyHome = value.OPENAIDY_HOME;
    return {
      ...value,
      // Internal aliases — `PORT`, `CORS_ORIGIN`, and `WS_PORT` are kept as
      // names consumers (app.ts, websocket gateway, tests) can read without
      // caring which source-of-truth env var produced them. `WS_PORT` rides
      // on `OPENAIDY_PORT` because the WS gateway shares the same listener.
      PORT: value.OPENAIDY_PORT,
      CORS_ORIGIN: value.OPENAIDY_CORS_ORIGIN,
      WS_PORT: value.OPENAIDY_PORT,
      APP_CONFIG_PATH:
        value.APP_CONFIG_PATH ??
        resolveOpenAidyPath(openAidyHome, 'openaidy.json'),
      BOOTSTRAP_ADMIN_TOKEN_PATH:
        value.BOOTSTRAP_ADMIN_TOKEN_PATH ??
        resolveOpenAidyPath(openAidyHome, 'credentials/bootstrap-admin.json'),
      WORKSPACE_BASE_DIR:
        value.WORKSPACE_BASE_DIR ??
        resolveOpenAidyPath(openAidyHome, 'workspaces'),
      SKILLS_DIR:
        value.SKILLS_DIR ?? resolveOpenAidyPath(openAidyHome, 'skills'),
    };
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(source);

  if (parsed.DB_KIND === 'sqlite' && !parsed.SQLITE_PATH) {
    return {
      ...parsed,
      SQLITE_PATH: resolveOpenAidyPath(
        parsed.OPENAIDY_HOME,
        'data/openaidy.db',
      ),
    };
  }

  return parsed;
}

export const env = parseEnv(process.env);
