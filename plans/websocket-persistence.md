# WebSocket Persistence Model

This document defines the persistence strategy for the WebSocket control plane, including paired devices, device credentials, node state, and runtime-only state.

## Persistence Decision Matrix

| State                      | Persistent  | Storage                     | Survives Restart | Notes                                       |
| -------------------------- | ----------- | --------------------------- | ---------------- | ------------------------------------------- |
| Pairing request state      | **Yes**     | `pairing_requests` table    | ✅               | Includes pending, approved, denied, expired |
| Approved device identity   | **Yes**     | `devices` table             | ✅               | Node ID, capabilities, scopes, token hash   |
| Token metadata (jti, hash) | **Yes**     | `devices.token_hash`        | ✅               | Only hash stored, not raw token             |
| Node registration metadata | **Partial** | In-memory + `devices` table | Partial          | Identity persists, live connection does not |
| Live WebSocket connection  | **No**      | In-memory only              | ❌               | Must reconnect after restart                |
| Presence state             | **No**      | In-memory only              | ❌               | Re-established on reconnect                 |
| Pending node invocations   | **No**      | In-memory only              | ❌               | Lost on restart, caller receives error      |
| Stream subscriptions       | **No**      | In-memory only              | ❌               | Must re-subscribe after reconnect           |

## State Definitions

### Persistent State

#### Pairing Requests (`pairing_requests` table)

- **Purpose**: Track pairing requests from initial submission through approval/denial/expiry
- **Lifecycle**: Created when device submits pairing request, updated through approval flow
- **Cleanup**: Expired requests may be periodically cleaned up but record is retained for audit

**Fields**:

- `id`: Unique request identifier
- `pairing_code`: Short code for approval UI
- `device_name`, `device_type`: Device metadata
- `requested_capabilities`: Capabilities requested by device
- `granted_scopes`: Scopes granted on approval
- `status`: `pending` | `approved` | `denied` | `expired`
- `expires_at`: When the pairing code expires
- `approved_at`, `approved_by`: Approval metadata
- `denied_at`, `denied_by`: Denial metadata
- `node_id`: Generated node ID on approval
- `token`: Issued token reference

#### Devices (`devices` table)

- **Purpose**: Store approved device identity and credential metadata
- **Lifecycle**: Created on pairing approval, updated on reconnect, revoked on deauthorization
- **Cleanup**: Never auto-deleted; status tracks lifecycle

**Fields**:

- `node_id`: Unique node identifier (primary key)
- `pairing_request_id`: Link to original pairing request
- `device_name`, `device_type`: Device metadata
- `capabilities`: Granted capabilities
- `scopes`: Granted scopes
- `token`: Token reference
- `token_hash`: Hash of token for validation (not raw token)
- `status`: `approved` | `revoked` | `offline` | `online` | `stale`
- `last_seen`: Last connection timestamp
- `created_at`, `updated_at`: Timestamps

### Ephemeral State

#### NodeRegistry (In-Memory)

- **Purpose**: Track currently connected nodes and their active connections
- **Lifecycle**: Populated on WebSocket connect, cleared on disconnect
- **Behavior**: Rebuilt from `devices` table on restart; only live connections lost

**Contents**:

- Active node connections indexed by node ID
- Connection metadata (client IDs, transport handles)
- No persistence - rebuilt from database on restart

#### PresenceManager (In-Memory)

- **Purpose**: Track real-time presence status for connected clients
- **Lifecycle**: Updated on presence changes, cleared on disconnect
- **Behavior**: Presence must be re-published after restart

#### StreamManager / SubscriptionManager (In-Memory)

- **Purpose**: Manage active stream subscriptions
- **Lifecycle**: Created on subscription request, cleared on disconnect
- **Behavior**: Subscriptions lost on restart; clients must re-subscribe

## Restart Behavior

### What Survives Server Restart

1. **Approved Devices**: Devices in the `devices` table with `status = 'approved'` remain approved
2. **Device Credentials**: Token hashes persist; tokens remain valid
3. **Pairing History**: All pairing request records retained
4. **Revocation Status**: Revoked devices (`status = 'revoked'`) remain revoked

### What Must Be Re-Established

1. **WebSocket Connections**: All clients disconnected, must reconnect
2. **Authentication**: Devices must re-authenticate using persisted credentials
3. **Presence Status**: Must re-publish presence after reconnect
4. **Stream Subscriptions**: Must re-subscribe to streams
5. **Pending Invocations**: Lost; callers receive errors

### Device Reconnection Flow

```
1. Device connects via WebSocket
2. Device sends `auth.authenticate` with token
3. Gateway validates token against `devices` table
4. If valid and not revoked:
   - Node registered in NodeRegistry (in-memory)
   - Device status updated to 'online' in DB
   - `node.registered` event emitted
5. If revoked or invalid:
   - Connection rejected with appropriate error
6. Device re-publishes presence
7. Device re-subscribes to streams
```

## Token Lifecycle

### Token Issuance

- Tokens are issued on pairing approval
- Token contains: `nodeId`, `scopes`, `iat`, `exp`
- Token is returned to device **once**; gateway does not store raw token
- Token **hash** is stored in `devices.token_hash`

### Token Validation

1. Extract `nodeId` from token claims
2. Look up device in `devices` table
3. Verify token hash matches stored hash
4. Verify device `status` is `approved` (not `revoked`)
5. Verify token not expired (exp claim)

### Token Expiration

- Tokens have configurable expiration (default: 30 days)
- Expired tokens must be renewed via re-pairing
- Token expiration does not revoke device; device can be re-approved

### Token Revocation

- Set `devices.status = 'revoked'` to revoke device
- All tokens for that device become invalid
- Revocation is persistent and survives restart

## Revocation and Deauthorization

### Revoking a Device

```sql
UPDATE devices SET status = 'revoked' WHERE node_id = ?;
```

- Revoked devices cannot authenticate
- Any active connections are terminated
- Revocation is immediate and persistent
- To re-authorize, device must be re-paired

### Checking Revocation Status

On every authentication:

```typescript
if (device.status === 'revoked') {
  throw new Error('Device revoked');
}
```

## Implementation Notes

### Database Requirements

- PostgreSQL or SQLite required for persistence
- If no database configured, pairing falls back to in-memory (NOT recommended for production)
- Run migrations to create `pairing_requests` and `devices` tables

### Security Considerations

- Raw tokens are **never** stored in the database
- Only token hashes are persisted for validation
- Token hashes are compared using constant-time comparison
- Revoked devices cannot authenticate even with valid token signature

### Configuration

```typescript
// Environment variables
DB_KIND=postgres          // or 'sqlite'
DATABASE_URL=postgresql://...
SQLITE_PATH=/path/to.db   // if using sqlite

// Pairing configuration
PAIRING_CODE_LENGTH=6
PAIRING_CODE_EXPIRY_MS=300000    // 5 minutes
TOKEN_EXPIRY_MS=2592000000       // 30 days
```

## API Integration

### Pairing Flow with Persistence

```
1. Device sends pairing.request
   → Creates record in pairing_requests (status: pending)

2. Operator sends pairing.approve
   → Updates pairing_requests (status: approved)
   → Creates record in devices (status: approved)
   → Returns token to device

3. Device disconnects

4. Device reconnects with token
   → Validates against devices table
   → Registers in NodeRegistry (in-memory)
   → Updates last_seen in devices
```

### Persistence-Enabled Services

The following services support persistence when databases are configured:

- **PairingService**: Stores requests and devices via `PairingRequestsStore` and `DevicesStore`
- **AuthMiddleware**: Validates tokens against persisted device records
- **NodeRegistry**: In-memory only, but bootstrap from `devices` table supported

## Testing Persistence

### Unit Tests

- Token hash validation logic
- Revocation status checks
- Status transitions

### Integration Tests

- Device authentication after restart (simulated by clearing in-memory state)
- Revoked device rejection
- Token expiration handling
- Persistence round-trip (create → persist → load → verify)

## Future Considerations

- Token rotation without re-pairing
- Multiple tokens per device
- Token usage auditing
- Device deprovisioning workflows
