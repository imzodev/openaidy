import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/addons';

type Database = DatabaseClient;

export interface CreateAddonInput {
  addonId: string;
  name: string;
  version: string;
  manifest: Record<string, unknown>;
  permissions?: string[];
  config?: Record<string, unknown>;
  installedBy: string;
}

export interface UpdateAddonInput {
  name?: string;
  version?: string;
  manifest?: Record<string, unknown>;
  status?: schema.AddonStatus;
  permissions?: string[];
  config?: Record<string, unknown>;
}

export class AddonsRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateAddonInput): Promise<schema.Addon> {
    const [row] = await this.db
      .insert(schema.addons)
      .values({
        id: nanoid(),
        addonId: input.addonId,
        name: input.name,
        version: input.version,
        manifest: input.manifest,
        permissions: input.permissions ?? [],
        config: input.config ?? {},
        status: 'installed' as const,
        installedBy: input.installedBy,
        installedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  async findById(id: string): Promise<schema.Addon | null> {
    const results = await this.db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  async findByAddonId(addonId: string): Promise<schema.Addon | null> {
    const results = await this.db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.addonId, addonId))
      .limit(1);
    return results[0] ?? null;
  }

  async list(options?: {
    status?: schema.AddonStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ addons: schema.Addon[]; total: number }> {
    const conditions = [];
    if (options?.status) {
      conditions.push(eq(schema.addons.status, options.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const addons = await this.db
      .select()
      .from(schema.addons)
      .where(whereClause)
      .orderBy(desc(schema.addons.installedAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.addons)
      .where(whereClause);

    return {
      addons,
      total: countResult[0]?.count ?? 0,
    };
  }

  async update(
    id: string,
    input: UpdateAddonInput,
  ): Promise<schema.Addon | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.version !== undefined) updateData.version = input.version;
    if (input.manifest !== undefined) updateData.manifest = input.manifest;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.permissions !== undefined)
      updateData.permissions = input.permissions;
    if (input.config !== undefined) updateData.config = input.config;

    const results = await this.db
      .update(schema.addons)
      .set(updateData)
      .where(eq(schema.addons.id, id))
      .returning();
    return results[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: schema.AddonStatus,
  ): Promise<schema.Addon | null> {
    return this.update(id, { status });
  }

  async delete(id: string): Promise<boolean> {
    const results = await this.db
      .delete(schema.addons)
      .where(eq(schema.addons.id, id))
      .returning();
    return results.length > 0;
  }

  async recordPermissionChange(input: {
    addonId: string;
    changedBy: string;
    oldPermissions: string[] | null;
    newPermissions: string[] | null;
    reason?: string;
  }): Promise<schema.AddonPermissionChange> {
    const [row] = await this.db
      .insert(schema.addonPermissionChanges)
      .values({
        id: nanoid(),
        addonId: input.addonId,
        changedBy: input.changedBy,
        oldPermissions: input.oldPermissions,
        newPermissions: input.newPermissions,
        reason: input.reason,
        createdAt: new Date(),
      })
      .returning();
    return row!;
  }

  async getPermissionChanges(
    addonId: string,
  ): Promise<schema.AddonPermissionChange[]> {
    return this.db
      .select()
      .from(schema.addonPermissionChanges)
      .where(eq(schema.addonPermissionChanges.addonId, addonId))
      .orderBy(desc(schema.addonPermissionChanges.createdAt));
  }

  async recordUsage(input: {
    addonId: string;
    endpoint: string;
  }): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    await this.db
      .insert(schema.addonUsage)
      .values({
        id: nanoid(),
        addonId: input.addonId,
        endpoint: input.endpoint,
        requestCount: 1,
        lastUsed: new Date(),
        date: today,
      })
      .onConflictDoUpdate({
        target: [
          schema.addonUsage.addonId,
          schema.addonUsage.endpoint,
          schema.addonUsage.date,
        ],
        set: {
          requestCount: sql`${schema.addonUsage.requestCount} + 1`,
          lastUsed: new Date(),
        },
      });
  }

  async getUsage(
    addonId: string,
    options?: { days?: number },
  ): Promise<schema.AddonUsage[]> {
    const conditions = [eq(schema.addonUsage.addonId, addonId)];

    if (options?.days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.days);
      const cutoffStr = cutoffDate.toISOString().split('T')[0]!;
      conditions.push(gte(schema.addonUsage.date, cutoffStr));
    }

    return this.db
      .select()
      .from(schema.addonUsage)
      .where(and(...conditions))
      .orderBy(desc(schema.addonUsage.date));
  }
}

export function createAddonsRepository(db: Database): AddonsRepository {
  return new AddonsRepository(db);
}
