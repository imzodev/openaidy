/**
 * Pairing Service
 *
 * Manages device pairing requests, approval flow, and token generation.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { DevicesStore, PairingRequestsStore } from '@openaidy/db';
import type { NodeType } from './node-registry';
import { AuthMiddleware, type JWTPayload } from './middleware/auth';

// ============================================================================
// Types
// ============================================================================

/**
 * Pairing request status
 */
export type PairingRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

/**
 * Pairing request
 */
export type PairingRequest = {
  requestId: string;
  pairingCode: string;
  deviceName: string;
  deviceType: NodeType;
  capabilities: string[];
  metadata?: Record<string, unknown>;
  status: PairingRequestStatus;
  requestedAt: number;
  expiresAt: number;
  approvedAt?: number;
  approvedBy?: string;
  deniedAt?: number;
  deniedBy?: string;
  nodeId?: string;
  token?: string;
  scopes?: string[];
};

/**
 * Pairing service options
 */
export type PairingServiceOptions = {
  /** Pairing code length (default: 6) */
  codeLength?: number;
  /** Request expiration time in milliseconds (default: 5 minutes) */
  requestExpiry?: number;
  /** Token expiration time in milliseconds (default: 30 days) */
  tokenExpiry?: number;
  /** Cleanup interval in milliseconds (default: 1 minute) */
  cleanupInterval?: number;
  /** Optional durable stores for restart-safe pairing/device state */
  persistence?: {
    pairingRequests: PairingRequestsStore;
    devices: DevicesStore;
  };
};

// ============================================================================
// Pairing Code Generator
// ============================================================================

/**
 * Generates secure pairing codes
 */
export class PairingCodeGenerator {
  private length: number;
  private charset: string;

  constructor(length: number = 6) {
    this.length = length;
    // Use digits only for easier manual entry
    this.charset = '0123456789';
  }

  /**
   * Generate a new pairing code
   */
  generate(): string {
    let code = '';
    const randomValues = new Uint32Array(this.length);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < this.length; i++) {
      code += this.charset[randomValues[i] % this.charset.length];
    }
    
    return code;
  }

  /**
   * Validate a pairing code format
   */
  validate(code: string): boolean {
    return new RegExp(`^\\d{${this.length}}$`).test(code);
  }
}

// ============================================================================
// Pairing Service
// ============================================================================

/**
 * Pairing service for managing device pairing requests
 */
export class PairingService {
  private requests: Map<string, PairingRequest> = new Map();
  private codeIndex: Map<string, string> = new Map(); // pairingCode -> requestId
  private tokenIndex: Map<string, string> = new Map(); // token -> requestId
  private options: {
    codeLength: number;
    requestExpiry: number;
    tokenExpiry: number;
    cleanupInterval: number;
  };
  private authMiddleware: AuthMiddleware;
  private logger: FastifyBaseLogger;
  private codeGenerator: PairingCodeGenerator;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private persistence:
    | {
        pairingRequests: PairingRequestsStore;
        devices: DevicesStore;
      }
    | undefined;
  private pendingWrites: Set<Promise<unknown>> = new Set();

  constructor(
    authMiddleware: AuthMiddleware,
    logger: FastifyBaseLogger,
    options: PairingServiceOptions = {},
  ) {
    this.authMiddleware = authMiddleware;
    this.logger = logger;
    this.persistence = options.persistence;
    
    this.options = {
      codeLength: options.codeLength ?? 6,
      requestExpiry: options.requestExpiry ?? 5 * 60 * 1000, // 5 minutes
      tokenExpiry: options.tokenExpiry ?? 30 * 24 * 60 * 60 * 1000, // 30 days
      cleanupInterval: options.cleanupInterval ?? 60 * 1000, // 1 minute
    };
    
    this.codeGenerator = new PairingCodeGenerator(this.options.codeLength);
    
    // Start cleanup timer
    this.startCleanupTimer();
  }

  async loadPersistedState(): Promise<void> {
    if (!this.persistence) return;

    const [requests, devices] = await Promise.all([
      this.persistence.pairingRequests.listAll(),
      this.persistence.devices.listAll(),
    ]);

    this.requests.clear();
    this.codeIndex.clear();
    this.tokenIndex.clear();

    for (const record of requests) {
      const request: PairingRequest = {
        requestId: record.id,
        pairingCode: record.pairingCode,
        deviceName: record.deviceName,
        deviceType: record.deviceType as NodeType,
        capabilities: record.requestedCapabilities,
        status: record.status,
        requestedAt: record.requestedAt.getTime(),
        expiresAt: record.expiresAt.getTime(),
        ...(record.metadata !== null && record.metadata !== undefined && { metadata: record.metadata }),
        ...(record.approvedAt && { approvedAt: record.approvedAt.getTime() }),
        ...(record.approvedBy && { approvedBy: record.approvedBy }),
        ...(record.deniedAt && { deniedAt: record.deniedAt.getTime() }),
        ...(record.deniedBy && { deniedBy: record.deniedBy }),
        ...(record.nodeId && { nodeId: record.nodeId }),
        ...(record.token && { token: record.token }),
        ...(record.grantedScopes && { scopes: record.grantedScopes }),
      };

      this.requests.set(request.requestId, request);
      if (request.status === 'pending') {
        this.codeIndex.set(request.pairingCode, request.requestId);
      }
      if (request.token) {
        this.tokenIndex.set(request.token, request.requestId);
      }
    }

    for (const device of devices) {
      if (device.token && device.pairingRequestId && !this.tokenIndex.has(device.token)) {
        this.tokenIndex.set(device.token, device.pairingRequestId);
      }
    }
  }

  async awaitPendingWrites(): Promise<void> {
    await Promise.all(Array.from(this.pendingWrites));
  }

  // ============================================================================
  // Request Lifecycle
  // ============================================================================

  /**
   * Create a new pairing request
   */
  createRequest(
    deviceName: string,
    deviceType: NodeType,
    capabilities: string[],
    metadata?: Record<string, unknown>,
  ): PairingRequest {
    const requestId = crypto.randomUUID();
    const pairingCode = this.generateUniqueCode();
    const now = Date.now();

    const request: PairingRequest = {
      requestId,
      pairingCode,
      deviceName,
      deviceType,
      capabilities,
      status: 'pending',
      requestedAt: now,
      expiresAt: now + this.options.requestExpiry,
      ...(metadata !== undefined && { metadata }),
    };

    this.requests.set(requestId, request);
    this.codeIndex.set(pairingCode, requestId);
    this.queuePersistence(
      this.persistence?.pairingRequests.create({
        id: requestId,
        pairingCode,
        deviceName,
        deviceType,
        requestedCapabilities: capabilities,
        requestedAt: new Date(now),
        expiresAt: new Date(now + this.options.requestExpiry),
        ...(metadata !== undefined && { metadata }),
      }),
    );

    this.logger.info(
      { requestId, pairingCode, deviceName, deviceType },
      'Pairing request created',
    );

    return request;
  }

  /**
   * Approve a pairing request
   */
  async approveRequest(
    requestId: string,
    approvedBy: string,
    scopes?: string[],
  ): Promise<PairingRequest | null> {
    const request = this.requests.get(requestId);
    
    if (!request) {
      this.logger.warn({ requestId }, 'Pairing request not found');
      return null;
    }

    if (request.status !== 'pending') {
      this.logger.warn(
        { requestId, status: request.status },
        'Pairing request is not pending',
      );
      return null;
    }

    // Check if request has expired
    if (Date.now() > request.expiresAt) {
      request.status = 'expired';
      this.logger.warn({ requestId }, 'Pairing request has expired');
      return request;
    }

    const now = Date.now();
    const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const grantedScopes = scopes ?? request.capabilities;

    // Generate token
    const token = await this.authMiddleware.generateToken({
      clientId: nodeId,
      type: 'pairing',
      scopes: grantedScopes,
      expiresIn: this.options.tokenExpiry,
    });

    request.status = 'approved';
    request.approvedAt = now;
    request.approvedBy = approvedBy;
    request.nodeId = nodeId;
    request.token = token;
    request.scopes = grantedScopes;

    // Update token index
    this.tokenIndex.set(token, requestId);
    this.queuePersistence(
      Promise.all([
        this.persistence?.pairingRequests.update(requestId, {
          status: 'approved',
          grantedScopes: grantedScopes,
          approvedAt: new Date(now),
          approvedBy,
          nodeId,
          token,
        }),
        this.persistence?.devices.upsert({
          nodeId,
          pairingRequestId: requestId,
          deviceName: request.deviceName,
          deviceType: request.deviceType,
          capabilities: request.capabilities,
          scopes: grantedScopes,
          token,
          tokenHash: token.substring(0, 16),
          status: 'approved',
          lastSeen: new Date(now),
          ...(request.metadata !== undefined && { metadata: request.metadata }),
        }),
      ]),
    );

    this.logger.info(
      { requestId, nodeId, approvedBy, scopes: grantedScopes },
      'Pairing request approved',
    );

    return request;
  }

  /**
   * Deny a pairing request
   */
  denyRequest(requestId: string, deniedBy: string): PairingRequest | null {
    const request = this.requests.get(requestId);
    
    if (!request) {
      this.logger.warn({ requestId }, 'Pairing request not found');
      return null;
    }

    if (request.status !== 'pending') {
      this.logger.warn(
        { requestId, status: request.status },
        'Pairing request is not pending',
      );
      return null;
    }

    request.status = 'denied';
    request.deniedAt = Date.now();
    request.deniedBy = deniedBy;
    this.queuePersistence(
      this.persistence?.pairingRequests.update(requestId, {
        status: 'denied',
        deniedAt: new Date(request.deniedAt),
        deniedBy,
      }),
    );

    this.logger.info(
      { requestId, deniedBy },
      'Pairing request denied',
    );

    return request;
  }

  // ============================================================================
  // Request Lookup
  // ============================================================================

  /**
   * Get a pairing request by ID
   */
  getRequest(requestId: string): PairingRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Get a pairing request by pairing code
   */
  getRequestByCode(pairingCode: string): PairingRequest | undefined {
    const requestId = this.codeIndex.get(pairingCode);
    if (!requestId) {
      return undefined;
    }
    return this.requests.get(requestId);
  }

  /**
   * Get all pending pairing requests
   */
  getPendingRequests(): PairingRequest[] {
    return Array.from(this.requests.values()).filter(
      request => request.status === 'pending',
    );
  }

  /**
   * Get all pairing requests
   */
  getAllRequests(): PairingRequest[] {
    return Array.from(this.requests.values());
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /**
   * Validate a pairing token
   */
  async validateToken(token: string): Promise<JWTPayload | null> {
    const payload = await this.authMiddleware.validateToken(token);
    
    if (!payload || payload.type !== 'pairing') {
      return null;
    }

    // Check if token is in our index
    if (!this.tokenIndex.has(token)) {
      return null;
    }

    return payload;
  }

  /**
   * Revoke a pairing token
   */
  revokeToken(token: string): boolean {
    const requestId = this.tokenIndex.get(token);
    
    if (!requestId) {
      return false;
    }

    this.tokenIndex.delete(token);
    
    const request = this.requests.get(requestId);
    if (request) {
      delete request.token;
      request.status = 'expired';
      this.queuePersistence(
        Promise.all([
          this.persistence?.pairingRequests.update(requestId, {
            status: 'expired',
            token: null,
          }),
          request.nodeId
            ? this.persistence?.devices.update(request.nodeId, {
                status: 'revoked',
                token: null,
              })
            : undefined,
        ]),
      );
    }

    this.logger.info({ requestId }, 'Pairing token revoked');
    
    return true;
  }

  /**
   * Get request by token
   */
  getRequestByToken(token: string): PairingRequest | undefined {
    const requestId = this.tokenIndex.get(token);
    if (!requestId) {
      return undefined;
    }
    return this.requests.get(requestId);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Cleanup expired requests
   */
  cleanupExpiredRequests(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [requestId, request] of this.requests) {
      if (request.status === 'pending' && now > request.expiresAt) {
        request.status = 'expired';
        this.codeIndex.delete(request.pairingCode);
        cleanedCount++;
        this.queuePersistence(
          this.persistence?.pairingRequests.update(requestId, {
            status: 'expired',
          }),
        );
        
        this.logger.debug({ requestId }, 'Pairing request expired');
      }
    }

    if (cleanedCount > 0) {
      this.logger.info({ count: cleanedCount }, 'Cleaned up expired pairing requests');
    }

    return cleanedCount;
  }

  /**
   * Clear all requests
   */
  clear(): void {
    this.requests.clear();
    this.codeIndex.clear();
    this.tokenIndex.clear();
    this.logger.info('Pairing service cleared');
  }

  /**
   * Destroy the service and cleanup resources
   */
  destroy(): void {
    this.stopCleanupTimer();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Generate a unique pairing code
   */
  private generateUniqueCode(): string {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = this.codeGenerator.generate();
      
      if (!this.codeIndex.has(code)) {
        return code;
      }
      
      attempts++;
    }

    // If we couldn't find a unique code, use a longer one
    const fallbackCode = `${this.codeGenerator.generate()}-${Date.now().toString(36).substr(-4)}`;
    this.logger.warn({ fallbackCode }, 'Using fallback pairing code');
    return fallbackCode;
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredRequests();
    }, this.options.cleanupInterval);
  }

  /**
   * Stop the cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = undefined;
  }

  private queuePersistence(operation: Promise<unknown> | undefined): void {
    if (!operation) return;

    this.pendingWrites.add(operation);
    operation
      .catch((error) => {
        this.logger.error({ err: error }, 'Failed to persist pairing state');
      })
      .finally(() => {
        this.pendingWrites.delete(operation);
      });
  }

  /**
   * Get the number of requests
   */
  get size(): number {
    return this.requests.size;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a pairing service instance
 */
export function createPairingService(
  authMiddleware: AuthMiddleware,
  logger: FastifyBaseLogger,
  options?: PairingServiceOptions,
): PairingService {
  return new PairingService(authMiddleware, logger, options);
}
