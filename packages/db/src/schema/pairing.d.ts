export declare const pairingRequestStatusEnum: import('drizzle-orm/pg-core').PgEnum<
  ['pending', 'approved', 'denied', 'expired']
>;
export declare const deviceStatusEnum: import('drizzle-orm/pg-core').PgEnum<
  ['approved', 'revoked', 'offline', 'online', 'stale']
>;
export declare const pairingRequests: import('drizzle-orm/pg-core').PgTableWithColumns<{
  name: 'pairing_requests';
  schema: undefined;
  columns: {
    id: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'id';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    pairingCode: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'pairing_code';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    deviceName: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'device_name';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    deviceType: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'device_type';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    requestedCapabilities: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'requested_capabilities';
        tableName: 'pairing_requests';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: string[];
        driverParam: unknown;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: string[];
      }
    >;
    grantedScopes: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'granted_scopes';
        tableName: 'pairing_requests';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: string[];
        driverParam: unknown;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: string[];
      }
    >;
    metadata: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'metadata';
        tableName: 'pairing_requests';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: Record<string, unknown>;
        driverParam: unknown;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: Record<string, unknown>;
      }
    >;
    status: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'status';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'pending' | 'approved' | 'denied' | 'expired';
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['pending', 'approved', 'denied', 'expired'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    requestedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'requested_at';
        tableName: 'pairing_requests';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    expiresAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'expires_at';
        tableName: 'pairing_requests';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    approvedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'approved_at';
        tableName: 'pairing_requests';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    approvedBy: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'approved_by';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    deniedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'denied_at';
        tableName: 'pairing_requests';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    deniedBy: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'denied_by';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    nodeId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'node_id';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    token: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'token';
        tableName: 'pairing_requests';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
  };
  dialect: 'pg';
}>;
export declare const devices: import('drizzle-orm/pg-core').PgTableWithColumns<{
  name: 'devices';
  schema: undefined;
  columns: {
    nodeId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'node_id';
        tableName: 'devices';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    pairingRequestId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'pairing_request_id';
        tableName: 'devices';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    deviceName: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'device_name';
        tableName: 'devices';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    deviceType: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'device_type';
        tableName: 'devices';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    capabilities: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'capabilities';
        tableName: 'devices';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: string[];
        driverParam: unknown;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: string[];
      }
    >;
    scopes: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'scopes';
        tableName: 'devices';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: string[];
        driverParam: unknown;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: string[];
      }
    >;
    metadata: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'metadata';
        tableName: 'devices';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: Record<string, unknown>;
        driverParam: unknown;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: Record<string, unknown>;
      }
    >;
    token: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'token';
        tableName: 'devices';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    tokenHash: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'token_hash';
        tableName: 'devices';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    status: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'status';
        tableName: 'devices';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'revoked' | 'approved' | 'offline' | 'online' | 'stale';
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['approved', 'revoked', 'offline', 'online', 'stale'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    lastSeen: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'last_seen';
        tableName: 'devices';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    createdAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'created_at';
        tableName: 'devices';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    updatedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'updated_at';
        tableName: 'devices';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
  };
  dialect: 'pg';
}>;
export type PairingRequestRecord = typeof pairingRequests.$inferSelect;
export type NewPairingRequestRecord = typeof pairingRequests.$inferInsert;
export type DeviceRecord = typeof devices.$inferSelect;
export type NewDeviceRecord = typeof devices.$inferInsert;
export type PairingRequestStatus =
  (typeof pairingRequestStatusEnum.enumValues)[number];
export type DeviceStatus = (typeof deviceStatusEnum.enumValues)[number];
