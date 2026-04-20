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
export declare class AddonsRepository {
  private readonly db;
  constructor(db: Database);
  create(input: CreateAddonInput): Promise<schema.Addon>;
  findById(id: string): Promise<schema.Addon | null>;
  findByAddonId(addonId: string): Promise<schema.Addon | null>;
  list(options?: {
    status?: schema.AddonStatus;
    limit?: number;
    offset?: number;
  }): Promise<{
    addons: schema.Addon[];
    total: number;
  }>;
  update(id: string, input: UpdateAddonInput): Promise<schema.Addon | null>;
  updateStatus(
    id: string,
    status: schema.AddonStatus,
  ): Promise<schema.Addon | null>;
  delete(id: string): Promise<boolean>;
  recordPermissionChange(input: {
    addonId: string;
    changedBy: string;
    oldPermissions: string[] | null;
    newPermissions: string[] | null;
    reason?: string;
  }): Promise<schema.AddonPermissionChange>;
  getPermissionChanges(
    addonId: string,
  ): Promise<schema.AddonPermissionChange[]>;
  recordUsage(input: { addonId: string; endpoint: string }): Promise<void>;
  getUsage(
    addonId: string,
    options?: {
      days?: number;
    },
  ): Promise<schema.AddonUsage[]>;
}
export declare function createAddonsRepository(db: Database): AddonsRepository;
export {};
