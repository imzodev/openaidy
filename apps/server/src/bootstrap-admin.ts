import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { AuthMiddleware, CAPABILITIES } from './websocket/middleware/auth';

export type BootstrapAdminRecord = {
  clientId: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

export type BootstrapAdminEnsureResult = {
  record: BootstrapAdminRecord;
  created: boolean;
};

export type BootstrapAdminOptions = {
  enabled: boolean;
  tokenPath: string;
  clientId: string;
  tokenExpiryMs: number;
};

export class BootstrapAdminManager {
  private authMiddleware: AuthMiddleware;
  private logger: FastifyBaseLogger;
  private options: BootstrapAdminOptions;
  private currentRecord: BootstrapAdminRecord | null = null;

  constructor(
    authMiddleware: AuthMiddleware,
    logger: FastifyBaseLogger,
    options: BootstrapAdminOptions,
  ) {
    this.authMiddleware = authMiddleware;
    this.logger = logger;
    this.options = options;
  }

  async ensureToken(): Promise<BootstrapAdminEnsureResult | null> {
    if (!this.options.enabled) {
      this.currentRecord = null;
      return null;
    }

    const existing = await this.loadValidRecord();
    if (existing) {
      this.currentRecord = existing;
      this.logger.info(
        {
          clientId: existing.clientId,
          tokenPath: this.options.tokenPath,
          expiresAt: existing.expiresAt,
        },
        'Bootstrap admin token loaded',
      );
      return { record: existing, created: false };
    }

    const record = await this.createRecord();
    await this.persistRecord(record);
    this.currentRecord = record;

    this.logger.warn(
      {
        clientId: record.clientId,
        tokenPath: this.options.tokenPath,
        expiresAt: record.expiresAt,
      },
      'Bootstrap admin token created',
    );
    this.logger.warn(
      { token: record.token },
      'Bootstrap admin token value (shown once on creation)',
    );

    return { record, created: true };
  }

  getRecord(): BootstrapAdminRecord | null {
    return this.currentRecord;
  }

  private async loadValidRecord(): Promise<BootstrapAdminRecord | null> {
    try {
      const raw = await readFile(this.options.tokenPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<BootstrapAdminRecord>;

      if (
        typeof parsed.clientId !== 'string' ||
        typeof parsed.token !== 'string' ||
        !Array.isArray(parsed.scopes) ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.expiresAt !== 'string'
      ) {
        return null;
      }

      const payload = await this.authMiddleware.validateToken(parsed.token);
      if (!payload) {
        return null;
      }

      if (payload.sub !== parsed.clientId) {
        return null;
      }

      if (!parsed.scopes.includes(CAPABILITIES.ADMIN)) {
        return null;
      }

      return {
        clientId: parsed.clientId,
        token: parsed.token,
        scopes: [...parsed.scopes],
        createdAt: parsed.createdAt,
        expiresAt: parsed.expiresAt,
      };
    } catch {
      return null;
    }
  }

  private async createRecord(): Promise<BootstrapAdminRecord> {
    const token = await this.authMiddleware.generateToken({
      clientId: this.options.clientId,
      type: 'access',
      scopes: [CAPABILITIES.ADMIN],
      expiresIn: this.options.tokenExpiryMs,
    });
    const payload = await this.authMiddleware.validateToken(token);

    if (!payload) {
      throw new Error('Failed to validate generated bootstrap admin token');
    }

    return {
      clientId: payload.sub,
      token,
      scopes: payload.scopes,
      createdAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  private async persistRecord(record: BootstrapAdminRecord): Promise<void> {
    await mkdir(dirname(this.options.tokenPath), { recursive: true });

    const tempPath = `${this.options.tokenPath}.tmp`;
    const contents = `${JSON.stringify(record, null, 2)}\n`;

    await writeFile(tempPath, contents, { encoding: 'utf-8', mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, this.options.tokenPath);
    await chmod(this.options.tokenPath, 0o600);
  }
}
