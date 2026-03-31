import { pgTable, text, timestamp, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';

export const pairingRequestStatusEnum = pgEnum('pairing_request_status', [
  'pending',
  'approved',
  'denied',
  'expired',
]);

export const deviceStatusEnum = pgEnum('device_status', [
  'approved',
  'revoked',
  'offline',
  'online',
  'stale',
]);

export const pairingRequests = pgTable('pairing_requests', {
  id: text('id').primaryKey(),
  pairingCode: text('pairing_code').notNull(),
  deviceName: text('device_name').notNull(),
  deviceType: text('device_type').notNull(),
  requestedCapabilities: jsonb('requested_capabilities').notNull().$type<string[]>(),
  grantedScopes: jsonb('granted_scopes').$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  status: pairingRequestStatusEnum('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  deniedAt: timestamp('denied_at', { withTimezone: true }),
  deniedBy: text('denied_by'),
  nodeId: text('node_id'),
  token: text('token'),
}, (table) => [
  index('pairing_requests_pairing_code_idx').on(table.pairingCode),
  index('pairing_requests_status_idx').on(table.status),
  index('pairing_requests_token_idx').on(table.token),
]);

export const devices = pgTable('devices', {
  nodeId: text('node_id').primaryKey(),
  pairingRequestId: text('pairing_request_id').references(() => pairingRequests.id, { onDelete: 'set null' }),
  deviceName: text('device_name').notNull(),
  deviceType: text('device_type').notNull(),
  capabilities: jsonb('capabilities').notNull().$type<string[]>(),
  scopes: jsonb('scopes').notNull().$type<string[]>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  token: text('token'),
  tokenHash: text('token_hash'),
  status: deviceStatusEnum('status').notNull().default('approved'),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('devices_pairing_request_id_idx').on(table.pairingRequestId),
  index('devices_status_idx').on(table.status),
  index('devices_token_idx').on(table.token),
]);

export type PairingRequestRecord = typeof pairingRequests.$inferSelect;
export type NewPairingRequestRecord = typeof pairingRequests.$inferInsert;
export type DeviceRecord = typeof devices.$inferSelect;
export type NewDeviceRecord = typeof devices.$inferInsert;
export type PairingRequestStatus = (typeof pairingRequestStatusEnum.enumValues)[number];
export type DeviceStatus = (typeof deviceStatusEnum.enumValues)[number];
