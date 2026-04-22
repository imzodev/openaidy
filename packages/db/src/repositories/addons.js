import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as schema from '../schema/addons';
export class AddonsRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  async create(input) {
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
        status: 'installed',
        installedBy: input.installedBy,
        installedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row;
  }
  async findById(id) {
    const results = await this.db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.id, id))
      .limit(1);
    return results[0] ?? null;
  }
  async findByAddonId(addonId) {
    const results = await this.db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.addonId, addonId))
      .limit(1);
    return results[0] ?? null;
  }
  async list(options) {
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
      .select({ count: sql`count(*)` })
      .from(schema.addons)
      .where(whereClause);
    return {
      addons,
      total: countResult[0]?.count ?? 0,
    };
  }
  async update(id, input) {
    const updateData = {
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
  async updateStatus(id, status) {
    return this.update(id, { status });
  }
  async delete(id) {
    const results = await this.db
      .delete(schema.addons)
      .where(eq(schema.addons.id, id))
      .returning();
    return results.length > 0;
  }
  async recordPermissionChange(input) {
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
    return row;
  }
  async getPermissionChanges(addonId) {
    return this.db
      .select()
      .from(schema.addonPermissionChanges)
      .where(eq(schema.addonPermissionChanges.addonId, addonId))
      .orderBy(desc(schema.addonPermissionChanges.createdAt));
  }
  async recordUsage(input) {
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
  async getUsage(addonId, options) {
    const conditions = [eq(schema.addonUsage.addonId, addonId)];
    if (options?.days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.days);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];
      conditions.push(gte(schema.addonUsage.date, cutoffStr));
    }
    return this.db
      .select()
      .from(schema.addonUsage)
      .where(and(...conditions))
      .orderBy(desc(schema.addonUsage.date));
  }
}
export function createAddonsRepository(db) {
  return new AddonsRepository(db);
}
