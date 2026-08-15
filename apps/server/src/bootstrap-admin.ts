import type { FastifyBaseLogger } from 'fastify';
import { AuthMiddleware, CAPABILITIES } from './websocket/middleware/auth';
import {
  loadValidBootstrapAdminRecord,
  persistBootstrapAdminRecord,
} from '@openaidy/control-plane';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';

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

    const existing = await loadValidBootstrapAdminRecord(
      this.options.tokenPath,
      (token) => this.authMiddleware.validateToken(token),
    );
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
    await persistBootstrapAdminRecord(this.options.tokenPath, record);
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
}
