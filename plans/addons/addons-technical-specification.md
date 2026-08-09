# OpenAidy Addons - Technical Specification

## Overview

The OpenAidy Addons system enables third-party developers to create UI extensions that integrate with the OpenAidy platform. Addons are frontend components that communicate with OpenAidy's agent system to provide specialized functionality while maintaining security and isolation.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Addon UI      │    │  Addon Proxy    │    │   Agent System │
│   (Frontend)    │◄──►│   (Backend)     │◄──►│   (Existing)    │
│                 │    │                 │    │                 │
│ - Custom UI     │    │ - Auth/Perms    │    │ - Tools         │
│ - Routes        │    │ - Validation    │    │ - MCP Servers   │
│ - State         │    │ - Rate Limit    │    │ - Sessions      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         └──────────────►│  Addon Registry │◄─────────────┘
                        │  (Management)   │
                        │ - Discovery     │
                        │ - Lifecycle     │
                        │ - Permissions   │
                        └─────────────────┘
```

## Core Components

### 1. Addon Manifest (addon.json)

Every addon must include a manifest file that defines its metadata, permissions, and integration points.

```json
{
  "$schema": "https://openaidy.dev/schemas/addon-v1.json",
  "id": "price-analyzer",
  "name": "Price Analyzer",
  "version": "1.0.0",
  "description": "Analyze prices across multiple sources",
  "author": {
    "name": "Example Corp",
    "email": "support@example.com",
    "url": "https://example.com"
  },
  "homepage": "https://github.com/example/price-analyzer",
  "repository": "https://github.com/example/price-analyzer.git",
  "license": "MIT",
  "openaidy": {
    "minVersion": "1.0.0",
    "maxVersion": "2.0.0"
  },
  "entry": "dist/index.js",
  "permissions": [
    "agents.invoke:price-analyzer",
    "sessions.read",
    "config.read:pricing"
  ],
  "ui": {
    "sidebar": {
      "icon": "chart-line",
      "label": "Price Analysis",
      "order": 100
    },
    "routes": [
      {
        "path": "/price-analyzer",
        "component": "PriceAnalyzerPage"
      },
      {
        "path": "/price-analyzer/history",
        "component": "HistoryPage"
      }
    ]
  },
  "agents": [
    {
      "id": "price-analyzer",
      "required": true,
      "description": "Main agent for price analysis"
    }
  ],
  "config": {
    "schema": "./config-schema.json",
    "defaults": {
      "refreshInterval": 300,
      "sources": ["amazon", "ebay"]
    }
  },
  "dependencies": {
    "openaidy": "^1.0.0"
  }
}
```

### 2. Permission System

Addons use a scoped permission system that builds on OpenAidy's existing JWT scopes.

#### Permission Types

- **Agent Permissions**: `agents.invoke:<agent-id>` - Can invoke specific agents
- **Session Permissions**: `sessions.read|write|delete` - Access to sessions
- **Config Permissions**: `config.read|write[:namespace]` - Access to configuration
- **System Permissions**: `system.addons.manage` - Manage other addons

#### Permission Enforcement

1. **Addon Registration**: When an addon is registered, it requests specific permissions
2. **Admin Approval**: Admin must approve requested permissions before activation
3. **Token Issuance**: Addon receives JWT tokens with only approved scopes
4. **Runtime Validation**: Every API call validates the addon's permissions

### 3. Addon Registry

The addon registry manages the lifecycle of addons:

#### Database Schema

```sql
-- Addons table
CREATE TABLE addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id VARCHAR(255) UNIQUE NOT NULL, -- From manifest
  name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  manifest JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'installed', -- installed, enabled, disabled, error
  permissions JSONB NOT NULL DEFAULT '[]', -- Approved permissions
  config JSONB NOT NULL DEFAULT '{}', -- Addon configuration
  installed_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  installed_by VARCHAR(255) NOT NULL -- User who installed
);

-- Addon permissions audit log
CREATE TABLE addon_permission_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID REFERENCES addons(id),
  changed_by VARCHAR(255) NOT NULL,
  old_permissions JSONB,
  new_permissions JSONB,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Registry API Endpoints

- `GET /api/addons` - List installed addons
- `POST /api/addons` - Install new addon
- `PUT /api/addons/:id` - Update addon configuration
- `DELETE /api/addons/:id` - Uninstall addon
- `POST /api/addons/:id/enable` - Enable addon
- `POST /api/addons/:id/disable` - Disable addon
- `GET /api/addons/:id/permissions` - Get addon permissions
- `PUT /api/addons/:id/permissions` - Update addon permissions

### 4. Addon Proxy Service

The addon proxy acts as a secure intermediary between addons and the rest of OpenAidy.

#### Responsibilities

1. **Authentication**: Validate addon JWT tokens
2. **Authorization**: Enforce addon-specific permissions
3. **Rate Limiting**: Prevent abuse per addon
4. **Request Logging**: Audit all addon activities
5. **Response Filtering**: Ensure addons don't receive sensitive data

#### Proxy Endpoints

```
POST /api/addon-proxy/agents/:agentId/invoke
GET  /api/addon-proxy/sessions
POST /api/addon-proxy/sessions
GET  /api/addon-proxy/config/:namespace
```

### 5. Client-Side Addon Loader

The addon loader dynamically loads and manages addon UI components.

#### Loading Process

1. **Discovery**: Fetch list of enabled addons from registry
2. **Manifest Loading**: Load and validate addon manifests
3. **Dynamic Import**: Load addon JavaScript modules
4. **Route Registration**: Register addon routes with router
5. **UI Integration**: Add addon to sidebar and navigation

#### Addon Runtime API

Addons receive a runtime API that provides secure access to OpenAidy:

```typescript
interface AddonRuntime {
  // Agent communication
  invokeAgent(agentId: string, input: any): Promise<any>;

  // Session management
  createSession(config: SessionConfig): Promise<Session>;
  getSession(id: string): Promise<Session>;

  // Configuration access
  getConfig(namespace?: string): Promise<any>;
  setConfig(namespace: string, config: any): Promise<void>;

  // UI utilities
  navigate(path: string): void;
  showNotification(message: string, type: 'info' | 'success' | 'error'): void;

  // Addon metadata
  getAddonInfo(): AddonInfo;
}
```

## Implementation Phases

### Phase 1: Foundation (Backend)

- [ ] Design and implement addon manifest schema validation
- [ ] Create addon registry database schema and migrations
- [ ] Implement addon registry API endpoints
- [ ] Create addon permission system
- [ ] Implement addon proxy service
- [ ] Add addon authentication middleware

### Phase 2: Foundation (Frontend)

- [ ] Implement addon loader system
- [ ] Create addon runtime API
- [ ] Update router to support dynamic addon routes
- [ ] Update sidebar to show addon navigation
- [ ] Create addon management UI

### Phase 3: Security & Isolation

- [ ] Implement fine-grained permission checking
- [ ] Add rate limiting for addon requests
- [ ] Create audit logging for addon activities
- [ ] Implement addon sandboxing (if needed)
- [ ] Add security scanning for addon uploads

### Phase 4: Developer Experience

- [ ] Create addon development CLI tool
- [ ] Implement addon validation and testing tools
- [ ] Create addon templates and examples
- [ ] Write comprehensive developer documentation
- [ ] Create addon publishing/deployment system

### Phase 5: Advanced Features

- [ ] Addon marketplace/discovery system
- [ ] Addon dependencies and version management
- [ ] Addon update system
- [ ] Addon analytics and usage metrics
- [ ] Addon monetization support (if needed)

## Security Considerations

### 1. Permission Model

- Principle of least privilege
- Explicit permission grants only
- Admin approval for permission changes
- Audit trail for all permission changes

### 2. Data Isolation

- Addons cannot access other addons' data
- Addons cannot access system configuration unless explicitly permitted
- Sensitive data filtering in proxy responses

### 3. Code Security

- Addon code validation before installation
- Static analysis for security vulnerabilities
- Sandboxed execution environment (future enhancement)

### 4. Rate Limiting

- Per-addon rate limits
- Global addon rate limits
- Admin override capabilities

## API Contracts

### Addon Registry API

#### Install Addon

```typescript
POST /api/addons
{
  manifest: AddonManifest,
  package: string // Base64 encoded addon package
}

Response:
{
  addon: AddonRecord,
  permissions: string[], // Requested permissions
  requiresApproval: boolean
}
```

#### Enable Addon

```typescript
POST /api/addons/:id/enable
{
  approvedPermissions: string[] // Admin-approved permissions
}

Response:
{
  addon: AddonRecord,
  accessToken: string // Addon JWT token
}
```

### Addon Proxy API

#### Invoke Agent

```typescript
POST /api/addon-proxy/agents/:agentId/invoke
{
  input: any,
  sessionId?: string
}

Response:
{
  result: any,
  usage: TokenUsage
}
```

## Database Schema Changes

### New Tables

```sql
-- Addons registry
CREATE TABLE addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  manifest JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'installed',
  permissions JSONB NOT NULL DEFAULT '[]',
  config JSONB NOT NULL DEFAULT '{}',
  installed_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  installed_by VARCHAR(255) NOT NULL
);

-- Addon permission audit log
CREATE TABLE addon_permission_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID REFERENCES addons(id),
  changed_by VARCHAR(255) NOT NULL,
  old_permissions JSONB,
  new_permissions JSONB,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Addon usage metrics
CREATE TABLE addon_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID REFERENCES addons(id),
  endpoint VARCHAR(255) NOT NULL,
  request_count INTEGER DEFAULT 0,
  last_used TIMESTAMP DEFAULT NOW(),
  date DATE NOT NULL,
  UNIQUE(addon_id, endpoint, date)
);
```

### New Indexes

```sql
CREATE INDEX idx_addons_status ON addons(status);
CREATE INDEX idx_addons_addon_id ON addons(addon_id);
CREATE INDEX idx_addon_usage_date ON addon_usage(date);
CREATE INDEX idx_addon_usage_addon_id ON addon_usage(addon_id);
```

## Testing Strategy

### Unit Tests

- Addon manifest validation
- Permission system logic
- Registry API endpoints
- Proxy service functionality

### Integration Tests

- Addon installation and activation flow
- Permission enforcement across API boundaries
- Addon loading and UI integration
- End-to-end addon functionality

### Security Tests

- Permission bypass attempts
- Rate limiting enforcement
- Data isolation verification
- Malicious addon detection

## Migration Plan

### Phase 1: No Breaking Changes

- Add addon tables to existing database
- Add new API endpoints alongside existing ones
- Addon system is opt-in

### Phase 2: Gradual Migration

- Existing features can be exposed as addons
- Backward compatibility maintained
- Optional migration path for existing functionality

### Phase 3: Full Integration

- Addons become primary extension mechanism
- Deprecate old extension methods (if any)
- Full addon ecosystem

## Performance Considerations

### Addon Loading

- Lazy loading of addon code
- Cached manifest validation
- Optimized bundle splitting

### Runtime Performance

- Efficient permission checking
- Minimal proxy overhead
- Optimized addon API calls

### Memory Usage

- Addon sandboxing limits
- Cleanup on addon disable
- Monitoring addon resource usage

## Monitoring and Observability

### Metrics to Track

- Addon installation/activation rates
- API usage per addon
- Permission change frequency
- Error rates per addon

### Logging Strategy

- Structured logging for addon activities
- Security event logging
- Performance metrics logging
- Error tracking and alerting

## Future Enhancements

### Advanced Features

- Addon marketplace
- Version management and updates
- Addon dependencies
- Monetization support

### Technical Improvements

- WebAssembly sandboxing
- Plugin hot-reloading
- Distributed addon registry
- Addon analytics dashboard

## Conclusion

The addons system provides a secure, extensible platform for third-party developers to build on OpenAidy's capabilities while maintaining security and performance. The phased approach allows for incremental development and testing of each component.

The key success factors are:

1. **Security First**: Robust permission system and isolation
2. **Developer Experience**: Clear APIs and good tooling
3. **Performance**: Minimal overhead for addon operations
4. **Flexibility**: Support for diverse addon types and use cases

This specification provides the foundation for building a thriving addon ecosystem around OpenAidy.
