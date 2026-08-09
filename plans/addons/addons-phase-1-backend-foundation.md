# Phase 1: Backend Foundation - Addons Implementation

## Overview

Phase 1 establishes the core backend infrastructure for the addons system. This phase focuses on creating the data models, API endpoints, and security foundations that enable addons to be registered, managed, and securely communicate with OpenAidy.

## Objectives

- Create addon manifest validation system
- Implement addon registry with database persistence
- Build permission system for addon access control
- Create addon proxy service for secure communication
- Add authentication middleware for addon requests

## Implementation Tasks

### 1. Addon Manifest Schema Validation

#### 1.1 Create Addon Manifest Types

**File: `packages/shared-types/src/addon.ts`**

```typescript
/**
 * Addon manifest interface
 */
export interface AddonManifest {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  description: string;
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  homepage?: string;
  repository?: string;
  license?: string;
  openaidy: {
    minVersion: string;
    maxVersion?: string;
  };
  entry: string;
  permissions: AddonPermission[];
  ui: AddonUIConfig;
  agents: AddonAgentReference[];
  config?: AddonConfigSchema;
  dependencies?: Record<string, string>;
}

export interface AddonPermission {
  // Agent permissions
  type: 'agent';
  action: 'invoke';
  target: string; // agent ID
} | {
  // Session permissions
  type: 'session';
  action: 'read' | 'write' | 'delete';
  target?: string; // optional session ID filter
} | {
  // Config permissions
  type: 'config';
  action: 'read' | 'write';
  target?: string; // optional namespace
} | {
  // System permissions
  type: 'system';
  action: 'addons.manage';
};

export interface AddonUIConfig {
  sidebar: {
    icon: string;
    label: string;
    order?: number;
  };
  routes: Array<{
    path: string;
    component: string;
    exact?: boolean;
  }>;
}

export interface AddonAgentReference {
  id: string;
  required: boolean;
  description: string;
}

export interface AddonConfigSchema {
  schema: string; // Path to JSON schema file
  defaults: Record<string, any>;
}

/**
 * Addon record as stored in database
 */
export interface AddonRecord {
  id: string;
  addonId: string;
  name: string;
  version: string;
  manifest: AddonManifest;
  status: 'installed' | 'enabled' | 'disabled' | 'error';
  permissions: string[];
  config: Record<string, any>;
  installedAt: string;
  updatedAt: string;
  installedBy: string;
}

/**
 * Addon installation request
 */
export interface CreateAddonRequest {
  manifest: AddonManifest;
  package: string; // Base64 encoded addon package
}

/**
 * Addon installation response
 */
export interface CreateAddonResponse {
  addon: AddonRecord;
  requestedPermissions: string[];
  requiresApproval: boolean;
}

/**
 * Addon permission update request
 */
export interface UpdateAddonPermissionsRequest {
  approvedPermissions: string[];
  reason?: string;
}

/**
 * Addon activation response
 */
export interface EnableAddonResponse {
  addon: AddonRecord;
  accessToken: string; // JWT token for addon
}
```

#### 1.2 Create JSON Schema for Manifest Validation

**File: `packages/shared-types/src/schemas/addon-manifest.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://openaidy.dev/schemas/addon-manifest-v1.json",
  "title": "OpenAidy Addon Manifest",
  "description": "Manifest file for OpenAidy addons",
  "type": "object",
  "required": [
    "id",
    "name",
    "version",
    "description",
    "author",
    "openaidy",
    "entry",
    "permissions",
    "ui",
    "agents"
  ],
  "properties": {
    "$schema": {
      "type": "string",
      "format": "uri"
    },
    "id": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$",
      "minLength": 3,
      "maxLength": 64,
      "description": "Unique identifier for the addon"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "description": "Human-readable name of the addon"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Semantic version of the addon"
    },
    "description": {
      "type": "string",
      "minLength": 10,
      "maxLength": 500,
      "description": "Description of what the addon does"
    },
    "author": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "email": {
          "type": "string",
          "format": "email"
        },
        "url": {
          "type": "string",
          "format": "uri"
        }
      }
    },
    "homepage": {
      "type": "string",
      "format": "uri"
    },
    "repository": {
      "type": "string",
      "format": "uri"
    },
    "license": {
      "type": "string"
    },
    "openaidy": {
      "type": "object",
      "required": ["minVersion"],
      "properties": {
        "minVersion": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$"
        },
        "maxVersion": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$"
        }
      }
    },
    "entry": {
      "type": "string",
      "pattern": "^\\./.*\\.js$",
      "description": "Entry point relative to addon root"
    },
    "permissions": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "required": ["type", "action", "target"],
            "properties": {
              "type": { "const": "agent" },
              "action": { "const": "invoke" },
              "target": { "type": "string" }
            }
          },
          {
            "type": "object",
            "required": ["type", "action"],
            "properties": {
              "type": { "const": "session" },
              "action": { "enum": ["read", "write", "delete"] },
              "target": { "type": "string" }
            }
          },
          {
            "type": "object",
            "required": ["type", "action"],
            "properties": {
              "type": { "const": "config" },
              "action": { "enum": ["read", "write"] },
              "target": { "type": "string" }
            }
          },
          {
            "type": "object",
            "required": ["type", "action"],
            "properties": {
              "type": { "const": "system" },
              "action": { "const": "addons.manage" }
            }
          }
        ]
      },
      "minItems": 1
    },
    "ui": {
      "type": "object",
      "required": ["sidebar", "routes"],
      "properties": {
        "sidebar": {
          "type": "object",
          "required": ["icon", "label"],
          "properties": {
            "icon": {
              "type": "string",
              "description": "Lucide icon name or custom SVG"
            },
            "label": {
              "type": "string",
              "minLength": 1,
              "maxLength": 50
            },
            "order": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "routes": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["path", "component"],
            "properties": {
              "path": {
                "type": "string",
                "pattern": "^/.*"
              },
              "component": {
                "type": "string",
                "pattern": "^[A-Z][a-zA-Z0-9]*$"
              },
              "exact": {
                "type": "boolean"
              }
            }
          },
          "minItems": 1
        }
      }
    },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "required", "description"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z0-9-]+$"
          },
          "required": {
            "type": "boolean"
          },
          "description": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "minItems": 1
    },
    "config": {
      "type": "object",
      "required": ["schema", "defaults"],
      "properties": {
        "schema": {
          "type": "string",
          "pattern": "^\\./.*\\.json$"
        },
        "defaults": {
          "type": "object"
        }
      }
    },
    "dependencies": {
      "type": "object",
      "patternProperties": {
        "^[a-z0-9-]+$": {
          "type": "string",
          "pattern": "^\\^\\d+\\.\\d+\\.\\d+$"
        }
      }
    }
  }
}
```

#### 1.3 Create Manifest Validator

**File: `apps/server/src/addons/manifest-validator.ts`**

```typescript
import { z } from 'zod';
import type { AddonManifest } from '@openaidy/shared-types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load JSON schema
const manifestSchema = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../packages/shared-types/src/schemas/addon-manifest.json',
    ),
    'utf-8',
  ),
);

export class ManifestValidator {
  /**
   * Validate addon manifest against JSON schema
   */
  static validate(manifest: unknown): AddonManifest {
    // Use zod to parse the manifest against the schema
    const parsed = z
      .object({
        $schema: z.string().optional(),
        id: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .min(3)
          .max(64),
        name: z.string().min(1).max(100),
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        description: z.string().min(10).max(500),
        author: z.object({
          name: z.string().min(1).max(100),
          email: z.string().email().optional(),
          url: z.string().url().optional(),
        }),
        homepage: z.string().url().optional(),
        repository: z.string().url().optional(),
        license: z.string().optional(),
        openaidy: z.object({
          minVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
          maxVersion: z
            .string()
            .regex(/^\d+\.\d+\.\d+$/)
            .optional(),
        }),
        entry: z.string().regex(/^\..*\.js$/),
        permissions: z
          .array(
            z.object({
              type: z.enum(['agent', 'session', 'config', 'system']),
              action: z.string(),
              target: z.string().optional(),
            }),
          )
          .min(1),
        ui: z.object({
          sidebar: z.object({
            icon: z.string(),
            label: z.string().min(1).max(50),
            order: z.number().int().min(0).optional(),
          }),
          routes: z
            .array(
              z.object({
                path: z.string().regex(/^\/.*/),
                component: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/),
                exact: z.boolean().optional(),
              }),
            )
            .min(1),
        }),
        agents: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9-]+$/),
              required: z.boolean(),
              description: z.string().min(1),
            }),
          )
          .min(1),
        config: z
          .object({
            schema: z.string().regex(/^\..*\.json$/),
            defaults: z.record(z.any()),
          })
          .optional(),
        dependencies: z
          .record(z.string().regex(/^\^\d+\.\d+\.\d+$/))
          .optional(),
      })
      .parse(manifest);

    return parsed as AddonManifest;
  }

  /**
   * Validate addon package structure
   */
  static validatePackage(packageBuffer: Buffer): {
    valid: boolean;
    errors: string[];
    manifest?: AddonManifest;
  } {
    const errors: string[] = [];
    let manifest: AddonManifest | undefined;

    try {
      // For now, assume package is a tar.gz containing addon files
      // In a real implementation, we'd extract and validate the package
      const packageContent = packageBuffer.toString('utf-8');

      // Try to extract and parse manifest
      // This is simplified - real implementation would extract from tar.gz
      const manifestMatch = packageContent.match(/"addon\.json":\s*({[^}]+})/);
      if (!manifestMatch) {
        errors.push('addon.json not found in package');
        return { valid: false, errors };
      }

      const manifestData = JSON.parse(manifestMatch[1]);
      manifest = this.validate(manifestData);
    } catch (error) {
      errors.push(
        `Package validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      manifest,
    };
  }

  /**
   * Check compatibility with current OpenAidy version
   */
  static checkCompatibility(
    manifest: AddonManifest,
    currentVersion: string,
  ): boolean {
    // Simple semver comparison - in real implementation use proper semver library
    const current = currentVersion.split('.').map(Number);
    const min = manifest.openaidy.minVersion.split('.').map(Number);

    // Check minimum version
    for (let i = 0; i < 3; i++) {
      if (current[i]! > min[i]!) return true;
      if (current[i]! < min[i]!) return false;
    }

    // Check maximum version if specified
    if (manifest.openaidy.maxVersion) {
      const max = manifest.openaidy.maxVersion.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (current[i]! < max[i]!) return true;
        if (current[i]! > max[i]!) return false;
      }
    }

    return true;
  }
}
```

### 2. Database Schema and Migrations

#### 2.1 Create Database Schema

**File: `packages/db/src/schema/addons.ts`**

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Addons registry table
 */
export const addons = pgTable(
  'addons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    addonId: varchar('addon_id', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    version: varchar('version', { length: 50 }).notNull(),
    manifest: jsonb('manifest').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('installed'),
    permissions: jsonb('permissions').notNull().default('[]'),
    config: jsonb('config').notNull().default('{}'),
    installedAt: timestamp('installed_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    installedBy: varchar('installed_by', { length: 255 }).notNull(),
  },
  (table) => ({
    statusIdx: index('idx_addons_status').on(table.status),
    addonIdIdx: index('idx_addons_addon_id').on(table.addonId),
  }),
);

/**
 * Addon permission changes audit log
 */
export const addonPermissionChanges = pgTable('addon_permission_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  addonId: uuid('addon_id').references(() => addons.id, {
    onDelete: 'cascade',
  }),
  changedBy: varchar('changed_by', { length: 255 }).notNull(),
  oldPermissions: jsonb('old_permissions'),
  newPermissions: jsonb('new_permissions'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Addon usage metrics
 */
export const addonUsage = pgTable(
  'addon_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    addonId: uuid('addon_id').references(() => addons.id, {
      onDelete: 'cascade',
    }),
    endpoint: varchar('endpoint', { length: 255 }).notNull(),
    requestCount: integer('request_count').default(0).notNull(),
    lastUsed: timestamp('last_used').defaultNow().notNull(),
    date: date('date').notNull(),
  },
  (table) => ({
    dateIdx: index('idx_addon_usage_date').on(table.date),
    addonIdIdx: index('idx_addon_usage_addon_id').on(table.addonId),
    uniqueIdx: index('idx_addon_usage_unique')
      .on(table.addonId, table.endpoint, table.date)
      .unique(),
  }),
);

// Types
export type Addon = typeof addons.$inferSelect;
export type NewAddon = typeof addons.$inferInsert;
export type AddonPermissionChange = typeof addonPermissionChanges.$inferSelect;
export type NewAddonPermissionChange =
  typeof addonPermissionChanges.$inferInsert;
export type AddonUsage = typeof addonUsage.$inferSelect;
export type NewAddonUsage = typeof addonUsage.$inferInsert;
```

#### 2.2 Create Migration

**File: `packages/db/drizzle/0002_addons.sql`**

```sql
-- Create addons table
CREATE TABLE "addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"addon_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"version" varchar(50) NOT NULL,
	"manifest" jsonb NOT NULL,
	"status" varchar(20) NOT NULL DEFAULT 'installed',
	"permissions" jsonb NOT NULL DEFAULT '[]',
	"config" jsonb NOT NULL DEFAULT '{}',
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"installed_by" varchar(255) NOT NULL
);

-- Create addon permission changes audit log
CREATE TABLE "addon_permission_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"addon_id" uuid NOT NULL,
	"changed_by" varchar(255) NOT NULL,
	"old_permissions" jsonb,
	"new_permissions" jsonb,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Create addon usage metrics table
CREATE TABLE "addon_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"addon_id" uuid NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_used" timestamp DEFAULT now() NOT NULL,
	"date" date NOT NULL
);

-- Create indexes
CREATE INDEX "idx_addons_status" ON "addons" ("status");
CREATE INDEX "idx_addons_addon_id" ON "addons" ("addon_id");
CREATE INDEX "idx_addon_usage_date" ON "addon_usage" ("date");
CREATE INDEX "idx_addon_usage_addon_id" ON "addon_usage" ("addon_id");
CREATE UNIQUE INDEX "idx_addons_addon_id_unique" ON "addons" ("addon_id");
CREATE UNIQUE INDEX "idx_addon_usage_unique" ON "addon_usage" ("addon_id", "endpoint", "date");

-- Add foreign key constraints
ALTER TABLE "addon_permission_changes" ADD CONSTRAINT "addon_permission_changes_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "addon_usage" ADD CONSTRAINT "addon_usage_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE no action ON UPDATE no action;
```

### 3. Addon Repository Layer

#### 3.1 Create Addon Repository

**File: `packages/db/src/repositories/addons.ts`**

```typescript
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { addons, addonPermissionChanges, addonUsage } from '../schema/addons';
import type {
  Addon,
  NewAddon,
  AddonPermissionChange,
  NewAddonPermissionChange,
  AddonUsage,
  NewAddonUsage,
} from '../schema/addons';

export interface AddonsStore {
  create(data: NewAddon): Promise<Addon>;
  findById(id: string): Promise<Addon | null>;
  findByAddonId(addonId: string): Promise<Addon | null>;
  list(filters?: { status?: string; installedBy?: string }): Promise<Addon[]>;
  update(id: string, data: Partial<NewAddon>): Promise<Addon | null>;
  delete(id: string): Promise<void>;
  updateStatus(id: string, status: string): Promise<Addon | null>;
  updatePermissions(id: string, permissions: string[]): Promise<Addon | null>;
  logPermissionChange(data: NewAddonPermissionChange): Promise<void>;
  recordUsage(data: NewAddonUsage): Promise<void>;
  getUsageStats(addonId: string, days?: number): Promise<AddonUsage[]>;
}

export class AddonsRepository implements AddonsStore {
  constructor(private db: Database) {}

  async create(data: NewAddon): Promise<Addon> {
    const [addon] = await this.db.insert(addons).values(data).returning();
    return addon;
  }

  async findById(id: string): Promise<Addon | null> {
    const [addon] = await this.db
      .select()
      .from(addons)
      .where(eq(addons.id, id))
      .limit(1);
    return addon || null;
  }

  async findByAddonId(addonId: string): Promise<Addon | null> {
    const [addon] = await this.db
      .select()
      .from(addons)
      .where(eq(addons.addonId, addonId))
      .limit(1);
    return addon || null;
  }

  async list(filters?: {
    status?: string;
    installedBy?: string;
  }): Promise<Addon[]> {
    let query = this.db.select().from(addons);

    if (filters?.status) {
      query = query.where(eq(addons.status, filters.status));
    }

    if (filters?.installedBy) {
      query = query.where(eq(addons.installedBy, filters.installedBy));
    }

    return await query.orderBy(desc(addons.installedAt));
  }

  async update(id: string, data: Partial<NewAddon>): Promise<Addon | null> {
    const [addon] = await this.db
      .update(addons)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(addons.id, id))
      .returning();
    return addon || null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(addons).where(eq(addons.id, id));
  }

  async updateStatus(id: string, status: string): Promise<Addon | null> {
    const [addon] = await this.db
      .update(addons)
      .set({ status, updatedAt: new Date() })
      .where(eq(addons.id, id))
      .returning();
    return addon || null;
  }

  async updatePermissions(
    id: string,
    permissions: string[],
  ): Promise<Addon | null> {
    const [addon] = await this.db
      .update(addons)
      .set({ permissions, updatedAt: new Date() })
      .where(eq(addons.id, id))
      .returning();
    return addon || null;
  }

  async logPermissionChange(data: NewAddonPermissionChange): Promise<void> {
    await this.db.insert(addonPermissionChanges).values(data);
  }

  async recordUsage(data: NewAddonUsage): Promise<void> {
    // Upsert usage record
    await this.db
      .insert(addonUsage)
      .values(data)
      .onConflictDoUpdate({
        target: [addonUsage.addonId, addonUsage.endpoint, addonUsage.date],
        set: {
          requestCount: sql`${addonUsage.requestCount} + 1`,
          lastUsed: new Date(),
        },
      });
  }

  async getUsageStats(
    addonId: string,
    days: number = 30,
  ): Promise<AddonUsage[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return await this.db
      .select()
      .from(addonUsage)
      .where(
        and(
          eq(addonUsage.addonId, addonId),
          sql`${addonUsage.date} >= ${cutoffDate.toISOString().split('T')[0]}`,
        ),
      )
      .orderBy(desc(addonUsage.date));
  }
}

export function createAddonsRepository(db: Database): AddonsStore {
  return new AddonsRepository(db);
}
```

### 4. Addon Service Layer

#### 4.1 Create Addon Service

**File: `apps/server/src/addons/service.ts`**

```typescript
import type { AddonsStore } from '@openaidy/db';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type {
  AddonManifest,
  AddonRecord,
  CreateAddonRequest,
  CreateAddonResponse,
  UpdateAddonPermissionsRequest,
  EnableAddonResponse,
} from '@openaidy/shared-types';
import { ManifestValidator } from './manifest-validator';

export interface AddonServiceOptions {
  addonsStore: AddonsStore;
  authMiddleware: AuthMiddleware;
  openaidyVersion: string;
}

export class AddonService {
  constructor(private options: AddonServiceOptions) {}

  /**
   * Install a new addon
   */
  async installAddon(
    request: CreateAddonRequest,
    installedBy: string,
  ): Promise<CreateAddonResponse> {
    // Validate manifest
    const manifest = ManifestValidator.validate(request.manifest);

    // Check compatibility
    if (
      !ManifestValidator.checkCompatibility(
        manifest,
        this.options.openaidyVersion,
      )
    ) {
      throw new Error(
        `Addon requires OpenAidy ${manifest.openaidy.minVersion}, current version is ${this.options.openaidyVersion}`,
      );
    }

    // Check if addon already exists
    const existing = await this.options.addonsStore.findByAddonId(manifest.id);
    if (existing) {
      throw new Error(`Addon ${manifest.id} is already installed`);
    }

    // Extract requested permissions from manifest
    const requestedPermissions = this.extractPermissions(manifest);

    // Create addon record
    const addon = await this.options.addonsStore.create({
      addonId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      status: 'installed',
      permissions: [], // Empty until approved
      config: manifest.config?.defaults || {},
      installedBy,
    });

    return {
      addon: this.toAddonRecord(addon),
      requestedPermissions,
      requiresApproval: requestedPermissions.length > 0,
    };
  }

  /**
   * Enable an addon with approved permissions
   */
  async enableAddon(
    addonId: string,
    request: UpdateAddonPermissionsRequest,
    approvedBy: string,
  ): Promise<EnableAddonResponse> {
    const addon = await this.options.addonsStore.findByAddonId(addonId);
    if (!addon) {
      throw new Error('Addon not found');
    }

    if (addon.status !== 'installed') {
      throw new Error('Addon must be in installed state to be enabled');
    }

    // Validate approved permissions against requested permissions
    const requestedPermissions = this.extractPermissions(addon.manifest);
    const invalidPermissions = request.approvedPermissions.filter(
      (p) => !requestedPermissions.includes(p),
    );

    if (invalidPermissions.length > 0) {
      throw new Error(`Invalid permissions: ${invalidPermissions.join(', ')}`);
    }

    // Log permission change
    await this.options.addonsStore.logPermissionChange({
      addonId: addon.id,
      changedBy: approvedBy,
      oldPermissions: addon.permissions,
      newPermissions: request.approvedPermissions,
      reason: request.reason,
    });

    // Update addon permissions and status
    await this.options.addonsStore.updatePermissions(
      addon.id,
      request.approvedPermissions,
    );
    const updatedAddon = await this.options.addonsStore.updateStatus(
      addon.id,
      'enabled',
    );

    if (!updatedAddon) {
      throw new Error('Failed to update addon');
    }

    // Generate addon JWT token
    const accessToken = await this.options.authMiddleware.generateToken({
      clientId: `addon:${addon.addonId}`,
      type: 'access',
      scopes: request.approvedPermissions,
    });

    return {
      addon: this.toAddonRecord(updatedAddon),
      accessToken,
    };
  }

  /**
   * Disable an addon
   */
  async disableAddon(
    addonId: string,
    disabledBy: string,
  ): Promise<AddonRecord> {
    const addon = await this.options.addonsStore.findByAddonId(addonId);
    if (!addon) {
      throw new Error('Addon not found');
    }

    if (addon.status !== 'enabled') {
      throw new Error('Addon is not currently enabled');
    }

    const updatedAddon = await this.options.addonsStore.updateStatus(
      addon.id,
      'disabled',
    );
    if (!updatedAddon) {
      throw new Error('Failed to disable addon');
    }

    return this.toAddonRecord(updatedAddon);
  }

  /**
   * Uninstall an addon
   */
  async uninstallAddon(addonId: string, uninstalledBy: string): Promise<void> {
    const addon = await this.options.addonsStore.findByAddonId(addonId);
    if (!addon) {
      throw new Error('Addon not found');
    }

    // TODO: Add cleanup logic (remove files, etc.)
    await this.options.addonsStore.delete(addon.id);
  }

  /**
   * List all addons
   */
  async listAddons(filters?: {
    status?: string;
    installedBy?: string;
  }): Promise<AddonRecord[]> {
    const addons = await this.options.addonsStore.list(filters);
    return addons.map((addon) => this.toAddonRecord(addon));
  }

  /**
   * Get addon by ID
   */
  async getAddon(addonId: string): Promise<AddonRecord | null> {
    const addon = await this.options.addonsStore.findByAddonId(addonId);
    return addon ? this.toAddonRecord(addon) : null;
  }

  /**
   * Update addon configuration
   */
  async updateAddonConfig(
    addonId: string,
    config: Record<string, any>,
  ): Promise<AddonRecord> {
    const addon = await this.options.addonsStore.findByAddonId(addonId);
    if (!addon) {
      throw new Error('Addon not found');
    }

    // Validate config against schema if present
    if (addon.manifest.config) {
      // TODO: Implement JSON schema validation
    }

    const updatedAddon = await this.options.addonsStore.update(addon.id, {
      config,
    });
    if (!updatedAddon) {
      throw new Error('Failed to update addon config');
    }

    return this.toAddonRecord(updatedAddon);
  }

  /**
   * Extract permission strings from manifest
   */
  private extractPermissions(manifest: AddonManifest): string[] {
    return manifest.permissions.map((perm) => {
      switch (perm.type) {
        case 'agent':
          return `agents.invoke:${perm.target}`;
        case 'session':
          return perm.target
            ? `sessions.${perm.action}:${perm.target}`
            : `sessions.${perm.action}`;
        case 'config':
          return perm.target
            ? `config.${perm.action}:${perm.target}`
            : `config.${perm.action}`;
        case 'system':
          return `system.${perm.action}`;
        default:
          throw new Error(`Unknown permission type: ${(perm as any).type}`);
      }
    });
  }

  /**
   * Convert database addon to AddonRecord
   */
  private toAddonRecord(addon: any): AddonRecord {
    return {
      id: addon.id,
      addonId: addon.addonId,
      name: addon.name,
      version: addon.version,
      manifest: addon.manifest,
      status: addon.status,
      permissions: addon.permissions,
      config: addon.config,
      installedAt: addon.installedAt.toISOString(),
      updatedAt: addon.updatedAt.toISOString(),
      installedBy: addon.installedBy,
    };
  }
}

export function createAddonService(options: AddonServiceOptions): AddonService {
  return new AddonService(options);
}
```

### 5. Addon Registry API Routes

#### 5.1 Create Addon Routes

**File: `apps/server/src/routes/addons.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify';
import type { AddonService } from '../addons/service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import type {
  CreateAddonRequest,
  CreateAddonResponse,
  UpdateAddonPermissionsRequest,
  EnableAddonResponse,
  AddonRecord,
} from '@openaidy/shared-types';

export type AddonRoutesOptions = {
  addonService: AddonService;
  authMiddleware: AuthMiddleware;
};

export const addonRoutes: FastifyPluginAsync<AddonRoutesOptions> = async (
  app,
  options,
) => {
  const { addonService, authMiddleware } = options;

  // Apply admin permission requirement to all addon management routes
  app.addHook(
    'preHandler',
    requireAuth({
      authMiddleware,
      requiredScope: 'system.addons.manage',
    }),
  );

  /**
   * POST /api/addons
   * Install a new addon
   */
  app.post<{
    Body: CreateAddonRequest;
    Reply: CreateAddonResponse;
  }>('/api/addons', async (request, reply) => {
    try {
      const result = await addonService.installAddon(
        request.body,
        request.user.sub, // From JWT payload
      );
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: 'addon.install_failed',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * GET /api/addons
   * List all addons
   */
  app.get<{
    Querystring: {
      status?: string;
      installedBy?: string;
    };
    Reply: { addons: AddonRecord[] };
  }>('/api/addons', async (request, reply) => {
    const addons = await addonService.listAddons(request.query);
    return reply.send({ addons });
  });

  /**
   * GET /api/addons/:id
   * Get addon by ID
   */
  app.get<{
    Params: { id: string };
    Reply: AddonRecord;
  }>('/api/addons/:id', async (request, reply) => {
    const addon = await addonService.getAddon(request.params.id);
    if (!addon) {
      return reply.code(404).send({
        error: 'addon.not_found',
        message: 'Addon not found',
      });
    }
    return reply.send(addon);
  });

  /**
   * PUT /api/addons/:id
   * Update addon configuration
   */
  app.put<{
    Params: { id: string };
    Body: { config: Record<string, any> };
    Reply: AddonRecord;
  }>('/api/addons/:id', async (request, reply) => {
    try {
      const addon = await addonService.updateAddonConfig(
        request.params.id,
        request.body.config,
      );
      return reply.send(addon);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: 'addon.update_failed',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * DELETE /api/addons/:id
   * Uninstall an addon
   */
  app.delete<{
    Params: { id: string };
  }>('/api/addons/:id', async (request, reply) => {
    try {
      await addonService.uninstallAddon(request.params.id, request.user.sub);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: 'addon.uninstall_failed',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * POST /api/addons/:id/enable
   * Enable an addon with approved permissions
   */
  app.post<{
    Params: { id: string };
    Body: UpdateAddonPermissionsRequest;
    Reply: EnableAddonResponse;
  }>('/api/addons/:id/enable', async (request, reply) => {
    try {
      const result = await addonService.enableAddon(
        request.params.id,
        request.body,
        request.user.sub,
      );
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: 'addon.enable_failed',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * POST /api/addons/:id/disable
   * Disable an addon
   */
  app.post<{
    Params: { id: string };
    Reply: AddonRecord;
  }>('/api/addons/:id/disable', async (request, reply) => {
    try {
      const addon = await addonService.disableAddon(
        request.params.id,
        request.user.sub,
      );
      return reply.send(addon);
    } catch (error) {
      if (error instanceof Error) {
        return reply.code(400).send({
          error: 'addon.disable_failed',
          message: error.message,
        });
      }
      throw error;
    }
  });
};
```

### 6. Addon Proxy Service

#### 6.1 Create Addon Proxy Service

**File: `apps/server/src/addons/proxy.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { AddonsStore } from '@openaidy/db';
import { requireAuth } from '../middleware/require-auth';

export interface AddonProxyOptions {
  authMiddleware: AuthMiddleware;
  addonsStore: AddonsStore;
}

/**
 * Addon proxy service - secure intermediary between addons and OpenAidy APIs
 */
export const addonProxyRoutes: FastifyPluginAsync<AddonProxyOptions> = async (
  app,
  options,
) => {
  const { authMiddleware, addonsStore } = options;

  /**
   * Middleware to validate addon JWT and extract addon info
   */
  const addonAuth = async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'addon.unauthorized',
        message: 'Addon token required',
      });
    }

    const token = authHeader.slice(7);
    const payload = await authMiddleware.validateToken(token);

    if (!payload) {
      return reply.code(401).send({
        error: 'addon.invalid_token',
        message: 'Invalid or expired addon token',
      });
    }

    // Extract addon ID from client ID
    const addonIdMatch = payload.sub.match(/^addon:(.+)$/);
    if (!addonIdMatch) {
      return reply.code(401).send({
        error: 'addon.invalid_client',
        message: 'Invalid addon client ID',
      });
    }

    const addonId = addonIdMatch[1];
    const addon = await addonsStore.findByAddonId(addonId);

    if (!addon || addon.status !== 'enabled') {
      return reply.code(401).send({
        error: 'addon.not_enabled',
        message: 'Addon is not enabled',
      });
    }

    // Attach addon info to request
    request.addon = addon;
    request.addonPermissions = payload.scopes;
  };

  /**
   * POST /api/addon-proxy/agents/:agentId/invoke
   * Proxy for agent invocation with permission checking
   */
  app.post<{
    Params: { agentId: string };
    Body: { input: any; sessionId?: string };
  }>(
    '/api/addon-proxy/agents/:agentId/invoke',
    {
      preHandler: [addonAuth],
    },
    async (request, reply) => {
      const { agentId } = request.params;
      const { input, sessionId } = request.body;
      const addon = request.addon;

      // Check if addon has permission to invoke this agent
      const requiredPermission = `agents.invoke:${agentId}`;
      if (!request.addonPermissions.includes(requiredPermission)) {
        return reply.code(403).send({
          error: 'addon.permission_denied',
          message: `Missing permission: ${requiredPermission}`,
        });
      }

      // Check if agent is in addon's manifest
      const hasAgent = addon.manifest.agents.some((a) => a.id === agentId);
      if (!hasAgent) {
        return reply.code(403).send({
          error: 'addon.agent_not_allowed',
          message: `Agent ${agentId} not in addon manifest`,
        });
      }

      try {
        // TODO: Implement actual agent invocation
        // This would call the existing agent invocation system
        const result = {
          result: `Agent ${agentId} invoked with input: ${JSON.stringify(input)}`,
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        };

        // Record usage
        await addonsStore.recordUsage({
          addonId: addon.id,
          endpoint: `agents.${agentId}.invoke`,
          requestCount: 1,
          lastUsed: new Date(),
          date: new Date().toISOString().split('T')[0],
        });

        return reply.send(result);
      } catch (error) {
        return reply.code(500).send({
          error: 'agent.invocation_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/addon-proxy/sessions
   * Proxy for session listing
   */
  app.get(
    '/api/addon-proxy/sessions',
    {
      preHandler: [addonAuth],
    },
    async (request, reply) => {
      const addon = request.addon;

      // Check session read permission
      const hasPermission = request.addonPermissions.some(
        (p) => p === 'sessions.read' || p.startsWith('sessions.read:'),
      );

      if (!hasPermission) {
        return reply.code(403).send({
          error: 'addon.permission_denied',
          message: 'Missing sessions.read permission',
        });
      }

      try {
        // TODO: Implement actual session listing
        const sessions = [
          { id: 'session-1', createdAt: new Date().toISOString() },
          { id: 'session-2', createdAt: new Date().toISOString() },
        ];

        // Record usage
        await addonsStore.recordUsage({
          addonId: addon.id,
          endpoint: 'sessions.list',
          requestCount: 1,
          lastUsed: new Date(),
          date: new Date().toISOString().split('T')[0],
        });

        return reply.send({ sessions });
      } catch (error) {
        return reply.code(500).send({
          error: 'sessions.list_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * POST /api/addon-proxy/sessions
   * Proxy for session creation
   */
  app.post<{
    Body: { config: any };
  }>(
    '/api/addon-proxy/sessions',
    {
      preHandler: [addonAuth],
    },
    async (request, reply) => {
      const addon = request.addon;

      // Check session write permission
      if (!request.addonPermissions.includes('sessions.write')) {
        return reply.code(403).send({
          error: 'addon.permission_denied',
          message: 'Missing sessions.write permission',
        });
      }

      try {
        // TODO: Implement actual session creation
        const session = {
          id: 'new-session-id',
          createdAt: new Date().toISOString(),
          config: request.body.config,
        };

        // Record usage
        await addonsStore.recordUsage({
          addonId: addon.id,
          endpoint: 'sessions.create',
          requestCount: 1,
          lastUsed: new Date(),
          date: new Date().toISOString().split('T')[0],
        });

        return reply.send(session);
      } catch (error) {
        return reply.code(500).send({
          error: 'sessions.create_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/addon-proxy/config/:namespace
   * Proxy for configuration access
   */
  app.get<{
    Params: { namespace?: string };
  }>(
    '/api/addon-proxy/config/:namespace?',
    {
      preHandler: [addonAuth],
    },
    async (request, reply) => {
      const { namespace } = request.params;
      const addon = request.addon;

      // Check config read permission
      const requiredPermission = namespace
        ? `config.read:${namespace}`
        : 'config.read';

      if (
        !request.addonPermissions.includes(requiredPermission) &&
        !request.addonPermissions.includes('config.read')
      ) {
        return reply.code(403).send({
          error: 'addon.permission_denied',
          message: `Missing permission: ${requiredPermission}`,
        });
      }

      try {
        // TODO: Implement actual config retrieval
        const config = namespace
          ? { [namespace]: { key: 'value' } }
          : { global: { key: 'value' } };

        // Record usage
        await addonsStore.recordUsage({
          addonId: addon.id,
          endpoint: `config.get.${namespace || 'global'}`,
          requestCount: 1,
          lastUsed: new Date(),
          date: new Date().toISOString().split('T')[0],
        });

        return reply.send(config);
      } catch (error) {
        return reply.code(500).send({
          error: 'config.get_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );
};
```

### 7. Integration with Main App

#### 7.1 Update App.ts

**File: `apps/server/src/app.ts` (additions)**

```typescript
// Add these imports
import { createAddonService } from './addons/service';
import { addonRoutes } from './routes/addons';
import { addonProxyRoutes } from './addons/proxy';
import { createAddonsRepository } from '@openaidy/db';

// In the buildApp function, after existing services setup:

// Create addon services
const addonsRepository = createAddonsRepository(db);
const addonService = createAddonService({
  addonsStore: addonsRepository,
  authMiddleware,
  openaidyVersion: '1.0.0', // TODO: Get from package.json
});

// Register addon management routes (admin only)
await app.register(addonRoutes, {
  addonService,
  authMiddleware,
});

// Register addon proxy routes (for addon communication)
await app.register(addonProxyRoutes, {
  authMiddleware,
  addonsStore: addonsRepository,
});
```

### 8. Testing

#### 8.1 Create Addon Service Tests

**File: `apps/server/src/addons/service.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddonService } from './service';
import type { AddonsStore } from '@openaidy/db';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { AddonManifest, CreateAddonRequest } from '@openaidy/shared-types';

describe('AddonService', () => {
  let addonService: AddonService;
  let mockAddonsStore: AddonsStore;
  let mockAuthMiddleware: AuthMiddleware;

  const mockManifest: AddonManifest = {
    id: 'test-addon',
    name: 'Test Addon',
    version: '1.0.0',
    description: 'A test addon for unit testing',
    author: { name: 'Test Author' },
    openaidy: { minVersion: '1.0.0' },
    entry: './dist/index.js',
    permissions: [
      { type: 'agent', action: 'invoke', target: 'test-agent' },
      { type: 'session', action: 'read' },
    ],
    ui: {
      sidebar: { icon: 'test', label: 'Test' },
      routes: [{ path: '/test', component: 'TestPage' }],
    },
    agents: [{ id: 'test-agent', required: true, description: 'Test agent' }],
  };

  beforeEach(() => {
    mockAddonsStore = {
      create: vi.fn(),
      findByAddonId: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateStatus: vi.fn(),
      updatePermissions: vi.fn(),
      logPermissionChange: vi.fn(),
      recordUsage: vi.fn(),
      getUsageStats: vi.fn(),
    } as any;

    mockAuthMiddleware = {
      generateToken: vi.fn(),
      validateToken: vi.fn(),
    } as any;

    addonService = new AddonService({
      addonsStore: mockAddonsStore,
      authMiddleware: mockAuthMiddleware,
      openaidyVersion: '1.0.0',
    });
  });

  describe('installAddon', () => {
    it('should install a valid addon', async () => {
      const request: CreateAddonRequest = {
        manifest: mockManifest,
        package: 'base64-encoded-package',
      };

      const mockAddon = {
        id: 'addon-id',
        addonId: 'test-addon',
        name: 'Test Addon',
        version: '1.0.0',
        manifest: mockManifest,
        status: 'installed',
        permissions: [],
        config: {},
        installedAt: new Date(),
        updatedAt: new Date(),
        installedBy: 'test-user',
      };

      mockAddonsStore.findByAddonId.mockResolvedValue(null);
      mockAddonsStore.create.mockResolvedValue(mockAddon);

      const result = await addonService.installAddon(request, 'test-user');

      expect(result).toEqual({
        addon: expect.objectContaining({
          addonId: 'test-addon',
          name: 'Test Addon',
        }),
        requestedPermissions: ['agents.invoke:test-agent', 'sessions.read'],
        requiresApproval: true,
      });
    });

    it('should throw error for incompatible version', async () => {
      const incompatibleManifest = {
        ...mockManifest,
        openaidy: { minVersion: '2.0.0' },
      };

      const request: CreateAddonRequest = {
        manifest: incompatibleManifest,
        package: 'base64-encoded-package',
      };

      await expect(
        addonService.installAddon(request, 'test-user'),
      ).rejects.toThrow('requires OpenAidy 2.0.0');
    });

    it('should throw error for duplicate addon', async () => {
      const request: CreateAddonRequest = {
        manifest: mockManifest,
        package: 'base64-encoded-package',
      };

      mockAddonsStore.findByAddonId.mockResolvedValue({} as any);

      await expect(
        addonService.installAddon(request, 'test-user'),
      ).rejects.toThrow('already installed');
    });
  });

  describe('enableAddon', () => {
    it('should enable addon with approved permissions', async () => {
      const mockAddon = {
        id: 'addon-id',
        addonId: 'test-addon',
        status: 'installed',
        manifest: mockManifest,
        permissions: [],
      };

      const mockUpdatedAddon = {
        ...mockAddon,
        status: 'enabled',
        permissions: ['agents.invoke:test-agent', 'sessions.read'],
      };

      mockAddonsStore.findByAddonId.mockResolvedValue(mockAddon);
      mockAddonsStore.updatePermissions.mockResolvedValue(mockAddon);
      mockAddonsStore.updateStatus.mockResolvedValue(mockUpdatedAddon);
      mockAuthMiddleware.generateToken.mockResolvedValue('jwt-token');

      const result = await addonService.enableAddon(
        'test-addon',
        { approvedPermissions: ['agents.invoke:test-agent', 'sessions.read'] },
        'admin-user',
      );

      expect(result).toEqual({
        addon: expect.objectContaining({
          status: 'enabled',
          permissions: ['agents.invoke:test-agent', 'sessions.read'],
        }),
        accessToken: 'jwt-token',
      });
    });
  });
});
```

## Success Criteria

Phase 1 is complete when:

1. ✅ **Manifest Validation**: Addon manifests can be validated against JSON schema
2. ✅ **Database Persistence**: Addons can be stored, retrieved, and managed in the database
3. ✅ **Permission System**: Addons request and receive specific permissions for agent access
4. ✅ **Registry API**: Admin can install, enable, disable, and configure addons via REST API
5. ✅ **Proxy Service**: Addons can communicate with OpenAidy through secure proxy with permission enforcement
6. ✅ **Authentication**: Addons receive JWT tokens with only their approved permissions
7. ✅ **Usage Tracking**: All addon API calls are logged and metered

## Next Steps

After Phase 1 completion:

- Begin Phase 2: Frontend foundation for addon loading and UI integration
- Create example addon to test the backend infrastructure
- Write comprehensive integration tests for the addon lifecycle

This phase provides the secure backend foundation that enables addons to be safely integrated into OpenAidy while maintaining strict access controls and auditability.
