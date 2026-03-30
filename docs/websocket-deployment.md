# WebSocket Deployment Guide

This guide covers deploying the OpenAidy WebSocket gateway in production environments.

## Deployment Options

### Standalone Deployment

The simplest deployment option is running the Fastify server directly with Node.js.

**Prerequisites:**
- Node.js 20+ (LTS recommended)
- npm or pnpm
- Reverse proxy (nginx, caddy, or similar)

**1. Build the Application**

```bash
# Clone and checkout
git clone https://github.com/imzodev/openaidy.git
cd openaidy
git checkout feat/ws

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

**2. Configure Environment**

```bash
# Create .env file
cat > .env << EOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# WebSocket Configuration
WS_ENABLED=true
WS_PATH=/ws
WS_MAX_CONNECTIONS=10000
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_MESSAGE_SIZE=1048576

# Authentication
JWT_SECRET=your-secure-secret-here
JWT_EXPIRY=86400

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
EOF
```

**3. Start the Server**

```bash
# Using PM2 for process management
npm install -g pm2

# Start with PM2
pm2 start apps/server/dist/index.js --name openaidy

# Save PM2 configuration
pm2 save
pm2 startup
```

**4. Configure Reverse Proxy (nginx)**

```nginx
# /etc/nginx/sites-available/openaidy
upstream openaidy {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.openaidy.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.openaidy.com;

    ssl_certificate /etc/letsencrypt/live/api.openaidy.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.openaidy.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # WebSocket upgrade
    location /ws {
        proxy_pass http://openaidy;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    # HTTP API
    location / {
        proxy_pass http://openaidy;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**5. Enable and Test**

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/openaidy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Test WebSocket connection
wscat -c wss://api.openaidy.com/ws?token=YOUR_TOKEN
```

### Container Deployment

**1. Create Dockerfile**

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/sdk/package.json ./packages/sdk/
COPY apps/server/package.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/shared-types ./packages/shared-types
COPY packages/sdk ./packages/sdk
COPY apps/server ./apps/server
COPY tsconfig.json ./

# Build
RUN pnpm build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Copy built files
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=nextjs:nodejs /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder --chown=nextjs:nodejs /app/packages/sdk/dist ./packages/sdk/dist

USER nextjs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/server/dist/index.js"]
```

**2. Build and Run**

```bash
# Build image
docker build -t openaidy:latest .

# Run container
docker run -d \
  --name openaidy \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET=your-secret \
  -e WS_MAX_CONNECTIONS=10000 \
  --restart unless-stopped \
  openaidy:latest
```

**3. Docker Compose**

```yaml
# docker-compose.yml
version: '3.8'

services:
  openaidy:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
      - WS_MAX_CONNECTIONS=10000
      - WS_HEARTBEAT_INTERVAL=30000
      - LOG_LEVEL=info
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
```

```bash
# Run with Docker Compose
docker-compose up -d
```

### Kubernetes Deployment

**1. Namespace and ConfigMap**

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: openaidy
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: openaidy-config
  namespace: openaidy
data:
  NODE_ENV: "production"
  PORT: "3000"
  WS_ENABLED: "true"
  WS_PATH: "/ws"
  WS_MAX_CONNECTIONS: "10000"
  WS_HEARTBEAT_INTERVAL: "30000"
  LOG_LEVEL: "info"
  LOG_FORMAT: "json"
```

**2. Secrets**

```yaml
# k8s/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: openaidy-secrets
  namespace: openaidy
type: Opaque
stringData:
  JWT_SECRET: "your-secure-secret-here"
  JWT_EXPIRY: "86400"
```

**3. Deployment**

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openaidy
  namespace: openaidy
  labels:
    app: openaidy
spec:
  replicas: 3
  selector:
    matchLabels:
      app: openaidy
  template:
    metadata:
      labels:
        app: openaidy
    spec:
      containers:
      - name: openaidy
        image: openaidy:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
        envFrom:
        - configMapRef:
            name: openaidy-config
        - secretRef:
            name: openaidy-secrets
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
      terminationGracePeriodSeconds: 60
```

**4. Service**

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: openaidy
  namespace: openaidy
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
    name: http
  selector:
    app: openaidy
```

**5. Ingress**

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: openaidy-ingress
  namespace: openaidy
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-read-timeout: "86400"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "86400"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
spec:
  tls:
  - hosts:
    - api.openaidy.com
    secretName: openaidy-tls
  rules:
  - host: api.openaidy.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: openaidy
            port:
              number: 80
```

**6. Horizontal Pod Autoscaler**

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: openaidy-hpa
  namespace: openaidy
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: openaidy
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

**7. Deploy to Kubernetes**

```bash
# Apply all manifests
kubectl apply -f k8s/

# Check deployment
kubectl get pods -n openaidy
kubectl get services -n openaidy
kubectl get ingress -n openaidy

# Check logs
kubectl logs -f deployment/openaidy -n openaidy
```

### Load Balancing

For high-traffic deployments, use multiple instances behind a load balancer.

**Nginx Load Balancer:**

```nginx
upstream websocket {
    least_conn;
    server 10.0.0.1:3000;
    server 10.0.0.2:3000;
    server 10.0.0.3:3000;
}

server {
    listen 443 ssl;
    server_name api.openaidy.com;

    # SSL config...

    location /ws {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Sticky sessions for WebSocket
        proxy_read_timeout 86400;
    }
}
```

**Important:** WebSocket connections are stateful. Use sticky sessions or ensure connections stay on the same backend.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `WS_ENABLED` | `true` | Enable WebSocket gateway |
| `WS_PATH` | `/ws` | WebSocket endpoint path |
| `WS_MAX_CONNECTIONS` | `10000` | Maximum concurrent connections |
| `WS_HEARTBEAT_INTERVAL` | `30000` | Heartbeat interval (ms) |
| `WS_MAX_MESSAGE_SIZE` | `1048576` | Max message size (1MB) |
| `JWT_SECRET` | - | JWT signing secret |
| `JWT_EXPIRY` | `86400` | Token expiry (seconds) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `LOG_LEVEL` | `info` | Logging level |
| `LOG_FORMAT` | `json` | Log format (json/pretty) |

### Production Configuration

**Recommended Production Values:**

```bash
# High-traffic production setup
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

WS_ENABLED=true
WS_PATH=/ws
WS_MAX_CONNECTIONS=50000
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_MESSAGE_SIZE=1048576
WS_MAX_CONNECTIONS_PER_USER=10

JWT_SECRET=your-256-bit-secret
JWT_EXPIRY=86400

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=200

LOG_LEVEL=info
LOG_FORMAT=json
```

### Security Configuration

**1. JWT Configuration**

```bash
# Generate secure secret
openssl rand -base64 32

# Use environment-specific secrets
JWT_SECRET=$(cat /run/secrets/jwt_secret)
```

**2. Token Validation**

```typescript
// Verify token structure
const validateTokenConfig = {
  issuer: 'openaidy',
  audience: 'api.openaidy.com',
  algorithms: ['HS256'],
  clockTolerance: 10,
};
```

**3. Rate Limiting**

```typescript
// Production rate limits
const rateLimits = {
  // Global limit
  global: {
    windowMs: 60_000,
    max: 10_000,
  },
  // Per-connection limit
  perConnection: {
    windowMs: 60_000,
    max: 100,
  },
  // Message-type specific
  message: {
    'session.message': { windowMs: 60_000, max: 50 },
    'presence.update': { windowMs: 60_000, max: 20 },
  },
};
```

### Performance Tuning

**Node.js Tuning:**

```bash
# Increase memory limit
NODE_OPTIONS="--max-old-space-size=4096"

# Enable garbage collection logging
NODE_OPTIONS="--trace-gc"

# Use all CPUs
UV_THREADPOOL_SIZE=$(nproc)
```

**System Tuning (Linux):**

```bash
# /etc/sysctl.conf
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30

# Apply changes
sudo sysctl -p
```

**File Descriptors:**

```bash
# /etc/security/limits.conf
* soft nofile 65535
* hard nofile 65535

# Check limits
ulimit -n
```

## Monitoring

### Metrics to Track

**Connection Metrics:**
- `ws_connections_active` - Current active connections
- `ws_connections_total` - Total connections created
- `ws_connections_failed` - Failed connection attempts
- `ws_connections_rate` - Connections per second

**Message Metrics:**
- `ws_messages_received_total` - Total messages received
- `ws_messages_sent_total` - Total messages sent
- `ws_messages_rate` - Messages per second
- `ws_message_size_bytes` - Message size histogram

**Performance Metrics:**
- `ws_latency_ms` - Message processing latency
- `ws_throughput_bytes` - Bytes per second
- `ws_errors_total` - Total errors
- `ws_timeouts_total` - Total timeouts

**Business Metrics:**
- `ws_sessions_active` - Active sessions
- `ws_agents_queries` - Agent queries
- `ws_messages_sent_to_llm` - Messages to LLM
- `ws_streams_active` - Active streams

### Logging Configuration

**JSON Logging (Production):**

```typescript
// Logging configuration
const loggingConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: 'json',
  timestamp: true,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
};
```

**Log Aggregation (ELK Stack):**

```yaml
# filebeat.yml
filebeat.inputs:
- type: log
  enabled: true
  paths:
    - /var/log/openaidy/*.log
  json.keys_under_root: true
  json.add_error_key: true

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "openaidy-%{+yyyy.MM.dd}"
```

### Alerting Setup

**Prometheus Alerts:**

```yaml
# alerts.yml
groups:
- name: websocket
  rules:
  - alert: HighConnectionCount
    expr: ws_connections_active > 8000
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High WebSocket connection count"
      description: "{{ $value }} active connections (threshold: 8000)"

  - alert: HighErrorRate
    expr: rate(ws_errors_total[5m]) > 10
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High WebSocket error rate"
      description: "{{ $value }} errors/second"

  - alert: HighLatency
    expr: histogram_quantile(0.95, ws_latency_ms) > 100
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High WebSocket latency"
      description: "P95 latency: {{ $value }}ms"

  - alert: LowThroughput
    expr: rate(ws_messages_received_total[5m]) < 10
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "Low WebSocket throughput"
      description: "{{ $value }} messages/second"
```

### Dashboard Examples

**Grafana Dashboard JSON:**

```json
{
  "dashboard": {
    "title": "WebSocket Gateway",
    "panels": [
      {
        "title": "Active Connections",
        "type": "graph",
        "targets": [
          {
            "expr": "ws_connections_active",
            "legendFormat": "Connections"
          }
        ]
      },
      {
        "title": "Message Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(ws_messages_received_total[1m])",
            "legendFormat": "Received/s"
          },
          {
            "expr": "rate(ws_messages_sent_total[1m])",
            "legendFormat": "Sent/s"
          }
        ]
      },
      {
        "title": "Latency (P95)",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, ws_latency_ms)",
            "legendFormat": "P95"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(ws_errors_total[5m])",
            "legendFormat": "Errors/s"
          }
        ]
      }
    ]
  }
}
```

## Scaling

### Horizontal Scaling

**Adding More Instances:**

1. **Stateless Design**: Each instance handles its own connections
2. **No Shared State**: No cross-instance communication needed
3. **Load Balancer**: Distributes connections across instances

**Scaling Checklist:**
- [ ] Load balancer configured with sticky sessions
- [ ] Health checks configured for all instances
- [ ] Monitoring dashboards updated
- [ ] Log aggregation scaled
- [ ] Database connection pooling increased

### Vertical Scaling

**Increasing Instance Capacity:**

| Connections | CPU | Memory | Network |
|-------------|-----|--------|---------|
| 10,000 | 2 cores | 2GB | 100Mbps |
| 25,000 | 4 cores | 4GB | 250Mbps |
| 50,000 | 8 cores | 8GB | 500Mbps |
| 100,000 | 16 cores | 16GB | 1Gbps |

**Recommendations:**
- Start with 4 cores, 4GB per instance
- Scale horizontally before vertically
- Monitor memory usage closely
- Use connection limits to prevent overload

### Connection Limits

**Per-Instance Limits:**

```typescript
const connectionLimits = {
  // Maximum concurrent connections
  maxConnections: 10_000,
  
  // Maximum connections per user
  maxConnectionsPerUser: 10,
  
  // Maximum subscriptions per connection
  maxSubscriptions: 100,
  
  // Maximum pending requests
  maxPendingRequests: 50,
  
  // Maximum message queue size
  maxMessageQueue: 100,
};
```

**Rate Limiting Tiers:**

```typescript
const rateLimitTiers = {
  // Anonymous connections
  anonymous: {
    windowMs: 60_000,
    max: 20,
  },
  
  // Authenticated users
  authenticated: {
    windowMs: 60_000,
    max: 100,
  },
  
  // Premium users
  premium: {
    windowMs: 60_000,
    max: 500,
  },
  
  // Service accounts
  service: {
    windowMs: 60_000,
    max: 1000,
  },
};
```

## Security

### TLS Configuration

**Certificate Management:**

```bash
# Using Let's Encrypt
certbot certonly --nginx -d api.openaidy.com

# Auto-renewal
certbot renew --dry-run
```

**TLS Best Practices:**

```nginx
# Modern TLS configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;

# HSTS
add_header Strict-Transport-Security "max-age=63072000" always;
```

### Firewall Rules

**Basic Firewall (ufw):**

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable
```

**Advanced Firewall (iptables):**

```bash
# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow SSH
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Rate limit WebSocket
iptables -A INPUT -p tcp --dport 443 -m limit --limit 100/minute --limit-burst 200 -j ACCEPT

# Drop everything else
iptables -A INPUT -j DROP
```

### Token Management

**Token Generation:**

```typescript
import jwt from 'jsonwebtoken';

interface TokenPayload {
  sub: string;
  capabilities: string[];
  iat: number;
  exp: number;
}

function generateToken(userId: string, capabilities: string[]): string {
  return jwt.sign(
    {
      sub: userId,
      capabilities,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '24h',
      issuer: 'openaidy',
      audience: 'api.openaidy.com',
    }
  );
}
```

**Token Refresh:**

```typescript
// Client-side token refresh
async function refreshToken(currentToken: string): Promise<string> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentToken}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Token refresh failed');
  }
  
  const { token } = await response.json();
  return token;
}

// Refresh token before expiry
function scheduleTokenRefresh(token: string, client: WebSocketClient): void {
  const payload = JSON.parse(atob(token.split('.')[1]));
  const expiresAt = payload.exp * 1000;
  const now = Date.now();
  const refreshAt = expiresAt - (5 * 60 * 1000); // 5 minutes before
  
  if (refreshAt > now) {
    setTimeout(async () => {
      try {
        const newToken = await refreshToken(token);
        client.updateToken(newToken);
        scheduleTokenRefresh(newToken, client);
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }, refreshAt - now);
  }
}
```

## Troubleshooting

### Common Issues

**1. Connection Refused**

```
Error: WebSocket connection failed: Connection refused
```

**Causes:**
- Server not running
- Firewall blocking port
- Wrong host/port

**Solutions:**
```bash
# Check if server is running
pm2 status
netstat -tlnp | grep 3000

# Check firewall
sudo ufw status
sudo iptables -L -n

# Check logs
pm2 logs openaidy
```

**2. Authentication Failed**

```
Error: Authentication failed: Invalid token
```

**Causes:**
- Expired token
- Invalid JWT secret
- Malformed token

**Solutions:**
```bash
# Check token expiry
echo "YOUR_TOKEN" | cut -d. -f2 | base64 -d | jq .exp

# Verify JWT secret
echo $JWT_SECRET

# Check token format
wscat -c wss://api.openaidy.com/ws?token=YOUR_TOKEN
```

**3. Rate Limit Exceeded**

```
Error: Rate limit exceeded
```

**Causes:**
- Too many requests
- Low rate limit configuration

**Solutions:**
```typescript
// Increase rate limits
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=200

// Or implement backoff in client
const client = new WebSocketClient({
  url: 'wss://api.openaidy.com/ws',
  retry: {
    baseInterval: 1000,
    maxInterval: 30000,
    maxRetries: 5,
  },
});
```

**4. Connection Drops**

```
Error: Connection closed unexpectedly
```

**Causes:**
- Network issues
- Server timeout
- Proxy timeout

**Solutions:**
```nginx
# Increase proxy timeout
proxy_read_timeout 86400;
proxy_send_timeout 86400;

# Increase heartbeat interval
WS_HEARTBEAT_INTERVAL=60000
```

### Debugging Techniques

**Enable Debug Logging:**

```bash
# Set log level
LOG_LEVEL=debug

# Check logs
pm2 logs openaidy --lines 100
```

**WebSocket Inspection:**

```bash
# Using wscat
wscat -c wss://api.openaidy.com/ws?token=YOUR_TOKEN -d

# Using websocat
websocat -v wss://api.openaidy.com/ws?token=YOUR_TOKEN
```

**Network Debugging:**

```bash
# Check connectivity
curl -v https://api.openaidy.com/health

# Check WebSocket upgrade
curl -v -H "Upgrade: websocket" -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://api.openaidy.com/ws
```

### Performance Issues

**High Memory Usage:**

```bash
# Check memory usage
pm2 monit

# Take heap snapshot
kill -USR2 $(pgrep node)

# Analyze with Chrome DevTools
# chrome://inspect
```

**High CPU Usage:**

```bash
# Profile CPU
node --prof apps/server/dist/index.js

# Analyze profile
node --prof-process isolate-*.log > profile.txt
```

**Slow Connections:**

```bash
# Check latency
ping api.openaidy.com

# Check DNS
nslookup api.openaidy.com

# Check SSL handshake
openssl s_client -connect api.openaidy.com:443 -servername api.openaidy.com
```

## Checklist

### Pre-Deployment

- [ ] Node.js 20+ installed
- [ ] Environment variables configured
- [ ] JWT secret generated (256-bit minimum)
- [ ] SSL certificates obtained
- [ ] Reverse proxy configured
- [ ] Firewall rules set
- [ ] Monitoring configured
- [ ] Log aggregation set up
- [ ] Health checks configured
- [ ] Rate limits configured

### Production Deployment

- [ ] Build completed successfully
- [ ] Tests passing
- [ ] Process manager configured (PM2)
- [ ] Auto-restart on failure
- [ ] Graceful shutdown handling
- [ ] Connection limits set
- [ ] Heartbeat monitoring enabled
- [ ] Error tracking enabled
- [ ] Alerts configured
- [ ] Dashboard created

### Post-Deployment

- [ ] Health check passing
- [ ] WebSocket connections working
- [ ] Authentication working
- [ ] Rate limiting working
- [ ] Logging working
- [ ] Metrics collecting
- [ ] Alerts firing correctly
- [ ] Documentation updated
- [ ] Team notified

## Summary

This deployment guide covers:

- **4 Deployment Options**: Standalone, Docker, Kubernetes, Load Balanced
- **Configuration**: Environment variables, security, performance tuning
- **Monitoring**: Metrics, logging, alerting, dashboards
- **Scaling**: Horizontal and vertical scaling strategies
- **Security**: TLS, firewalls, token management
- **Troubleshooting**: Common issues, debugging, performance

Follow the checklists to ensure a successful production deployment.
