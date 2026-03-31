import { eq, desc } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/pairing';

type Database = DatabaseClient;

export class PairingRequestsRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    id: string;
    pairingCode: string;
    deviceName: string;
    deviceType: string;
    requestedCapabilities: string[];
    metadata?: Record<string, unknown>;
    status?: schema.PairingRequestStatus;
    requestedAt: Date;
    expiresAt: Date;
  }): Promise<schema.PairingRequestRecord> {
    const [record] = await this.db
      .insert(schema.pairingRequests)
      .values({
        id: input.id,
        pairingCode: input.pairingCode,
        deviceName: input.deviceName,
        deviceType: input.deviceType,
        requestedCapabilities: input.requestedCapabilities,
        metadata: input.metadata,
        status: input.status ?? 'pending',
        requestedAt: input.requestedAt,
        expiresAt: input.expiresAt,
      })
      .returning();

    return record!;
  }

  async findById(id: string): Promise<schema.PairingRequestRecord | null> {
    const results = await this.db
      .select()
      .from(schema.pairingRequests)
      .where(eq(schema.pairingRequests.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  async findByCode(pairingCode: string): Promise<schema.PairingRequestRecord | null> {
    const results = await this.db
      .select()
      .from(schema.pairingRequests)
      .where(eq(schema.pairingRequests.pairingCode, pairingCode))
      .limit(1);

    return results[0] ?? null;
  }

  async findByToken(token: string): Promise<schema.PairingRequestRecord | null> {
    const results = await this.db
      .select()
      .from(schema.pairingRequests)
      .where(eq(schema.pairingRequests.token, token))
      .limit(1);

    return results[0] ?? null;
  }

  async listAll(): Promise<schema.PairingRequestRecord[]> {
    return this.db
      .select()
      .from(schema.pairingRequests)
      .orderBy(desc(schema.pairingRequests.requestedAt));
  }

  async listPending(): Promise<schema.PairingRequestRecord[]> {
    return this.db
      .select()
      .from(schema.pairingRequests)
      .where(eq(schema.pairingRequests.status, 'pending'))
      .orderBy(desc(schema.pairingRequests.requestedAt));
  }

  async update(
    id: string,
    updates: {
      status?: schema.PairingRequestStatus;
      grantedScopes?: string[];
      approvedAt?: Date | null;
      approvedBy?: string | null;
      deniedAt?: Date | null;
      deniedBy?: string | null;
      nodeId?: string | null;
      token?: string | null;
      expiresAt?: Date;
    },
  ): Promise<schema.PairingRequestRecord | null> {
    const results = await this.db
      .update(schema.pairingRequests)
      .set(updates)
      .where(eq(schema.pairingRequests.id, id))
      .returning();

    return results[0] ?? null;
  }
}

export class DevicesRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: {
    nodeId: string;
    pairingRequestId?: string | null;
    deviceName: string;
    deviceType: string;
    capabilities: string[];
    scopes: string[];
    metadata?: Record<string, unknown>;
    token?: string | null;
    tokenHash?: string | null;
    status?: schema.DeviceStatus;
    lastSeen?: Date;
  }): Promise<schema.DeviceRecord> {
    const now = new Date();
    const [record] = await this.db
      .insert(schema.devices)
      .values({
        nodeId: input.nodeId,
        pairingRequestId: input.pairingRequestId ?? null,
        deviceName: input.deviceName,
        deviceType: input.deviceType,
        capabilities: input.capabilities,
        scopes: input.scopes,
        metadata: input.metadata,
        token: input.token ?? null,
        tokenHash: input.tokenHash ?? null,
        status: input.status ?? 'approved',
        lastSeen: input.lastSeen ?? now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.devices.nodeId,
        set: {
          pairingRequestId: input.pairingRequestId ?? null,
          deviceName: input.deviceName,
          deviceType: input.deviceType,
          capabilities: input.capabilities,
          scopes: input.scopes,
          metadata: input.metadata,
          token: input.token ?? null,
          tokenHash: input.tokenHash ?? null,
          status: input.status ?? 'approved',
          lastSeen: input.lastSeen ?? now,
          updatedAt: now,
        },
      })
      .returning();

    return record!;
  }

  async findByNodeId(nodeId: string): Promise<schema.DeviceRecord | null> {
    const results = await this.db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.nodeId, nodeId))
      .limit(1);

    return results[0] ?? null;
  }

  async findByToken(token: string): Promise<schema.DeviceRecord | null> {
    const results = await this.db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.token, token))
      .limit(1);

    return results[0] ?? null;
  }

  async listAll(): Promise<schema.DeviceRecord[]> {
    return this.db
      .select()
      .from(schema.devices)
      .orderBy(desc(schema.devices.updatedAt));
  }

  async update(
    nodeId: string,
    updates: {
      deviceName?: string;
      deviceType?: string;
      capabilities?: string[];
      scopes?: string[];
      metadata?: Record<string, unknown>;
      token?: string | null;
      tokenHash?: string | null;
      status?: schema.DeviceStatus;
      lastSeen?: Date;
    },
  ): Promise<schema.DeviceRecord | null> {
    const results = await this.db
      .update(schema.devices)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(schema.devices.nodeId, nodeId))
      .returning();

    return results[0] ?? null;
  }
}

export function createPairingRequestsRepository(db: Database): PairingRequestsRepository {
  return new PairingRequestsRepository(db);
}

export function createDevicesRepository(db: Database): DevicesRepository {
  return new DevicesRepository(db);
}
