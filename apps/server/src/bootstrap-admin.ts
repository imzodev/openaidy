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
  /**
   * Fraction of `tokenExpiryMs` remaining at which point the token is
   * proactively re-minted (default 0.2 — renew once 20% of its
   * lifetime is left). Lets a long-running server keep a valid token
   * on disk indefinitely without ever needing a manual restart.
   */
  renewalThresholdFraction?: number;
  /** How often to check whether renewal is due. Default 6 hours. */
  renewalCheckIntervalMs?: number;
};

const DEFAULT_RENEWAL_THRESHOLD_FRACTION = 0.2;
const DEFAULT_RENEWAL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class BootstrapAdminManager {
  private authMiddleware: AuthMiddleware;
  private logger: FastifyBaseLogger;
  private options: BootstrapAdminOptions;
  private currentRecord: BootstrapAdminRecord | null = null;
  private renewalTimer: NodeJS.Timeout | null = null;

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

  /**
   * Start a background timer that periodically checks whether the
   * current token is due for renewal (see {@link maybeRenewToken}).
   * No-op if bootstrap admin is disabled or a timer is already running.
   * The timer is `unref()`'d so it never keeps the process alive on
   * its own — server shutdown still requires {@link stopAutoRenew}
   * (wired into the app's `onClose` hook) to avoid a delayed handle.
   */
  startAutoRenew(): void {
    if (!this.options.enabled || this.renewalTimer) {
      return;
    }

    const intervalMs =
      this.options.renewalCheckIntervalMs ?? DEFAULT_RENEWAL_CHECK_INTERVAL_MS;

    this.renewalTimer = setInterval(() => {
      this.maybeRenewToken().catch((err) => {
        this.logger.error(
          { err },
          'Bootstrap admin token renewal check failed',
        );
      });
    }, intervalMs);
    this.renewalTimer.unref();
  }

  stopAutoRenew(): void {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  /**
   * Re-mint and persist the token if the current record is within
   * `renewalThresholdFraction` of its expiry. No-op otherwise (or if
   * disabled / no token has been loaded yet via {@link ensureToken}).
   */
  async maybeRenewToken(): Promise<BootstrapAdminEnsureResult | null> {
    if (!this.options.enabled || !this.currentRecord) {
      return null;
    }

    const fraction =
      this.options.renewalThresholdFraction ??
      DEFAULT_RENEWAL_THRESHOLD_FRACTION;
    const thresholdMs = this.options.tokenExpiryMs * fraction;
    const remainingMs =
      new Date(this.currentRecord.expiresAt).getTime() - Date.now();

    if (remainingMs > thresholdMs) {
      return null;
    }

    const previousExpiresAt = this.currentRecord.expiresAt;
    const record = await this.createRecord();
    await persistBootstrapAdminRecord(this.options.tokenPath, record);
    this.currentRecord = record;

    this.logger.warn(
      {
        clientId: record.clientId,
        tokenPath: this.options.tokenPath,
        previousExpiresAt,
        expiresAt: record.expiresAt,
      },
      'Bootstrap admin token proactively renewed before expiry',
    );
    this.logger.warn(
      { token: record.token },
      'Bootstrap admin token value (shown once on renewal)',
    );

    return { record, created: true };
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
