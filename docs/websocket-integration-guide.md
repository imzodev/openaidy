# WebSocket Integration Guide

This guide explains how to integrate the OpenAidy WebSocket gateway with various types of applications.

## Integration Patterns

### Web Application Integration

#### Browser with Native WebSocket

```html
<!DOCTYPE html>
<html>
<head>
  <title>OpenAidy Chat</title>
</head>
<body>
  <div id="messages"></div>
  <input type="text" id="input" placeholder="Type a message...">
  <button onclick="sendMessage()">Send</button>

  <script>
    const ws = new WebSocket(`wss://api.openaidy.com/ws?token=${localStorage.getItem('token')}`);
    
    ws.onopen = () => {
      console.log('Connected');
      // Subscribe to session events
      ws.send(JSON.stringify({
        id: 'req_1',
        type: 'session.subscribe',
        timestamp: new Date().toISOString(),
        payload: { sessionId: 'my-session' }
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'session.message') {
        displayMessage(message.payload.content);
      }
    };

    function sendMessage() {
      const input = document.getElementById('input');
      ws.send(JSON.stringify({
        id: 'req_2',
        type: 'session.message',
        timestamp: new Date().toISOString(),
        payload: {
          sessionId: 'my-session',
          content: input.value,
          stream: false
        }
      }));
      input.value = '';
    }

    function displayMessage(content) {
      const div = document.createElement('div');
      div.textContent = content;
      document.getElementById('messages').appendChild(div);
    }
  </script>
</body>
</html>
```

#### Using the SDK

```typescript
import { createWebSocketClient } from '@openaidy/sdk';

// Initialize client
const client = createWebSocketClient({
  url: 'wss://api.openaidy.com/ws',
  token: localStorage.getItem('token'),
  autoReconnect: true,
});

// Connect and set up
async function init() {
  await client.connect();
  
  // Subscribe to messages
  client.on('session.message', (data) => {
    displayMessage(data.payload.content);
  });

  // Create session
  const session = await client.createSession({ agentId: 'assistant' });
  return session.payload.sessionId;
}

// Send message
async function sendMessage(sessionId, content) {
  return client.sendMessage(sessionId, content);
}
```

#### React Integration

```typescript
import { useEffect, useState, useRef } from 'react';
import { createWebSocketClient, WebSocketClient } from '@openaidy/sdk';

function useWebSocket(url: string, token: string) {
  const clientRef = useRef<WebSocketClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const client = createWebSocketClient({ url, token });
    
    client.onStateChange((state) => {
      setConnected(state === 'connected');
    });

    client.connect().catch(console.error);
    clientRef.current = client;

    return () => client.destroy();
  }, [url, token]);

  return { client: clientRef.current, connected };
}

function ChatComponent({ token }) {
  const { client, connected } = useWebSocket('wss://api.openaidy.com/ws', token);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    if (!client) return;

    client.on('session.message', (data) => {
      setMessages(prev => [...prev, {
        role: data.payload.role,
        content: data.payload.content,
      }]);
    });
  }, [client]);

  const createSession = async () => {
    if (!client) return;
    const result = await client.createSession({ agentId: 'assistant' });
    setSessionId(result.payload.sessionId);
  };

  const send = async (content: string) => {
    if (!client || !sessionId) return;
    await client.sendMessage(sessionId, content);
  };

  if (!connected) return <div>Connecting...</div>;

  return (
    <div>
      {!sessionId && <button onClick={createSession}>Start Chat</button>}
      {messages.map((msg, i) => (
        <div key={i}>{msg.content}</div>
      ))}
      <input onKeyDown={(e) => {
        if (e.key === 'Enter') send(e.currentTarget.value);
      }} />
    </div>
  );
}
```

#### Vue Integration

```vue
<template>
  <div>
    <div v-if="!connected">Connecting...</div>
    <div v-else>
      <div v-for="msg in messages" :key="msg.id">{{ msg.content }}</div>
      <input v-model="input" @keydown.enter="sendMessage" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { createWebSocketClient } from '@openaidy/sdk';

const props = defineProps(['token']);

const client = ref(null);
const connected = ref(false);
const messages = ref([]);
const input = ref('');
const sessionId = ref(null);

onMounted(async () => {
  client.value = createWebSocketClient({
    url: 'wss://api.openaidy.com/ws',
    token: props.token,
  });

  client.value.onStateChange((state) => {
    connected.value = state === 'connected';
  });

  client.value.on('session.message', (data) => {
    messages.value.push({
      id: data.payload.messageId,
      content: data.payload.content,
    });
  });

  await client.value.connect();
  
  const result = await client.value.createSession({ agentId: 'assistant' });
  sessionId.value = result.payload.sessionId;
});

onUnmounted(() => {
  client.value?.destroy();
});

async function sendMessage() {
  if (!client.value || !sessionId.value || !input.value) return;
  
  await client.value.sendMessage(sessionId.value, input.value);
  input.value = '';
}
</script>
```

### Mobile Application Integration

#### React Native

```typescript
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { createWebSocketClient, WebSocketClient } from '@openaidy/sdk';

function useWebSocket(url: string, token: string) {
  const clientRef = useRef<WebSocketClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const client = createWebSocketClient({
      url,
      token,
      autoReconnect: true,
      maxReconnectAttempts: 10,
    });

    client.onStateChange((state) => {
      setConnected(state === 'connected');
    });

    client.connect().catch(console.error);
    clientRef.current = client;

    // Handle app backgrounding
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        client.reconnect().catch(console.error);
      } else if (nextAppState === 'background') {
        client.updatePresence('away');
      }
    });

    return () => {
      subscription.remove();
      client.destroy();
    };
  }, [url, token]);

  return { client: clientRef.current, connected };
}

// Usage in component
function ChatScreen() {
  const { client, connected } = useWebSocket(
    'wss://api.openaidy.com/ws',
    userToken
  );

  // Component logic...
}
```

#### iOS (Swift)

```swift
import Foundation

class WebSocketClient: NSObject, URLSessionWebSocketDelegate {
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession!
    private let url: URL
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 10
    
    init(url: URL, token: String) {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: true)!
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        self.url = components.url!
        super.init()
        
        let configuration = URLSessionConfiguration.default
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }
    
    func connect() {
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()
        receiveMessage()
    }
    
    func disconnect() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
    }
    
    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .data(let data):
                    self?.handleData(data)
                case .string(let text):
                    self?.handleText(text)
                @unknown default:
                    break
                }
                self?.receiveMessage()
            case .failure(let error):
                print("WebSocket error: \(error)")
                self?.reconnect()
            }
        }
    }
    
    func send(message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8) else { return }
        
        webSocketTask?.send(.string(text)) { error in
            if let error = error {
                print("Send error: \(error)")
            }
        }
    }
    
    private func handleText(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .websocketMessage,
                object: json
            )
        }
    }
    
    private func handleData(_ data: Data) {
        // Handle binary data if needed
    }
    
    private func reconnect() {
        guard reconnectAttempts < maxReconnectAttempts else { return }
        
        reconnectAttempts += 1
        let delay = min(1000 * pow(2, Double(reconnectAttempts)), 30000)
        
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(Int(delay))) { [weak self] in
            self?.connect()
        }
    }
    
    // URLSessionWebSocketDelegate
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        reconnectAttempts = 0
        NotificationCenter.default.post(name: .websocketConnected, object: nil)
    }
    
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        NotificationCenter.default.post(name: .websocketDisconnected, object: nil)
        reconnect()
    }
}

// Usage
let client = WebSocketClient(
    url: URL(string: "wss://api.openaidy.com/ws")!,
    token: "your-jwt-token"
)
client.connect()

// Send message
client.send(message: [
    "id": "req_1",
    "type": "session.create",
    "timestamp": ISO8601DateFormatter().string(from: Date()),
    "payload": ["agentId": "assistant"]
])
```

#### Android (Kotlin)

```kotlin
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class WebSocketClient(
    private val url: String,
    private val token: String,
    private val listener: WebSocketEventListener
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(java.time.Duration.ofSeconds(30))
        .build()
    
    private var webSocket: WebSocket? = null
    private var reconnectAttempts = 0
    private val maxReconnectAttempts = 10

    fun connect() {
        val urlWithToken = "$url?token=$token"
        val request = Request.Builder()
            .url(urlWithToken)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                reconnectAttempts = 0
                listener.onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                listener.onMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                listener.onDisconnected()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                listener.onError(t.message ?: "Unknown error")
                reconnect()
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, "Client disconnect")
    }

    fun send(message: String) {
        webSocket?.send(message)
    }

    private fun reconnect() {
        if (reconnectAttempts >= maxReconnectAttempts) return

        reconnectAttempts++
        val delay = minOf(1000L * (1 shl reconnectAttempts), 30000L)

        Handler(Looper.getMainLooper()).postDelayed({
            connect()
        }, delay)
    }
}

interface WebSocketEventListener {
    fun onConnected()
    fun onDisconnected()
    fun onMessage(text: String)
    fun onError(error: String)
}

// Usage
val client = WebSocketClient(
    url = "wss://api.openaidy.com/ws",
    token = "your-jwt-token",
    listener = object : WebSocketEventListener {
        override fun onConnected() {
            // Send initial requests
        }
        override fun onMessage(text: String) {
            val json = JSONObject(text)
            when (json.getString("type")) {
                "session.message" -> handleMessage(json)
                // Handle other message types
            }
        }
        override fun onDisconnected() {}
        override fun onError(error: String) {}
    }
)

client.connect()
```

### CLI Tool Integration

#### Node.js CLI

```typescript
#!/usr/bin/env node
import { createWebSocketClient } from '@openaidy/sdk';
import * as readline from 'readline';

async function main() {
  const token = process.env.OPENAIDY_TOKEN;
  if (!token) {
    console.error('Set OPENAIDY_TOKEN environment variable');
    process.exit(1);
  }

  const client = createWebSocketClient({
    url: process.env.OPENAIDY_WS_URL || 'wss://api.openaidy.com/ws',
    token,
    logger: {
      info: (msg) => console.error(`[INFO] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
      warn: (msg) => console.error(`[WARN] ${msg}`),
      debug: () => {}, // Suppress debug in CLI
    },
  });

  // Handle messages
  client.on('session.message', (data) => {
    console.log(`\nAssistant: ${data.payload.content}`);
    rl.prompt();
  });

  client.on('session.stream.delta', (data) => {
    process.stdout.write(data.payload.delta);
  });

  client.on('session.stream.done', () => {
    console.log();
    rl.prompt();
  });

  await client.connect();
  console.log('Connected to OpenAidy');

  // Create session
  const session = await client.createSession({
    agentId: process.env.AGENT_ID || 'assistant',
  });
  
  const sessionId = session.payload.sessionId;
  console.log(`Session: ${sessionId}`);
  console.log('Type your message and press Enter. Press Ctrl+C to exit.\n');

  // Read input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const content = line.trim();
    if (!content) {
      rl.prompt();
      return;
    }

    try {
      await client.sendMessage(sessionId, content, { stream: true });
    } catch (error) {
      console.error('Error:', error.message);
      rl.prompt();
    }
  });

  rl.on('close', () => {
    client.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
```

### Service-to-Service Integration

#### Backend Service

```typescript
import { createWebSocketClient } from '@openaidy/sdk';

class OpenAidyService {
  private client;
  private connected = false;

  constructor(private config: { url: string; token: string }) {
    this.client = createWebSocketClient({
      url: config.url,
      token: config.token,
      autoReconnect: true,
      maxReconnectAttempts: 20,
    });

    this.client.onStateChange((state) => {
      this.connected = state === 'connected';
    });
  }

  async start() {
    await this.client.connect();
  }

  async stop() {
    this.client.destroy();
  }

  async processMessage(content: string, context?: Record<string, unknown>) {
    if (!this.connected) {
      throw new Error('Not connected to OpenAidy');
    }

    // Create session for this request
    const session = await this.client.createSession({
      agentId: context?.agentId || 'default',
      metadata: context,
    });

    const sessionId = session.payload.sessionId;

    // Send message and wait for response
    const response = await this.client.sendMessage(sessionId, content);

    // Clean up
    await this.client.deleteSession(sessionId);

    return response.payload.content;
  }

  async *streamMessage(content: string, context?: Record<string, unknown>) {
    if (!this.connected) {
      throw new Error('Not connected to OpenAidy');
    }

    const session = await this.client.createSession({
      agentId: context?.agentId || 'default',
    });

    const sessionId = session.payload.sessionId;
    const chunks: string[] = [];
    let resolve: () => void;
    let done = false;

    const handler = (data: any) => {
      if (data.type === 'session.stream.delta') {
        chunks.push(data.payload.delta);
      } else if (data.type === 'session.stream.done') {
        done = true;
        if (resolve) resolve();
      }
    };

    this.client.on('session.stream.delta', handler);
    this.client.on('session.stream.done', handler);

    await this.client.sendMessage(sessionId, content, { stream: true });

    // Yield chunks as they arrive
    while (!done) {
      while (chunks.length > 0) {
        yield chunks.shift()!;
      }
      await new Promise<void>((r) => { resolve = r; });
    }

    // Yield remaining chunks
    while (chunks.length > 0) {
      yield chunks.shift()!;
    }

    this.client.off('session.stream.delta', handler);
    this.client.off('session.stream.done', handler);
    await this.client.deleteSession(sessionId);
  }
}

// Usage
const service = new OpenAidyService({
  url: 'wss://api.openaidy.com/ws',
  token: process.env.SERVICE_TOKEN!,
});

await service.start();

// Process single message
const response = await service.processMessage('Hello!');

// Stream response
for await (const chunk of service.streamMessage('Tell me a story')) {
  process.stdout.write(chunk);
}
```

## Migration from REST

### Mapping REST Endpoints to WebSocket Messages

| REST Endpoint | WebSocket Type |
|---------------|----------------|
| `POST /api/sessions` | `session.create` |
| `GET /api/sessions/:id` | `session.get` |
| `GET /api/sessions` | `session.list` |
| `DELETE /api/sessions/:id` | `session.delete` |
| `POST /api/sessions/:id/messages` | `session.message` |
| `GET /api/agents` | `agent.list` |
| `GET /api/agents/:id` | `agent.get` |
| `GET /api/providers` | `provider.list` |
| `GET /api/providers/:id/models` | `provider.models` |

### Step-by-Step Migration

**1. Install SDK**

```bash
npm install @openaidy/sdk
```

**2. Replace REST Client**

```typescript
// Before (REST)
const response = await fetch('/api/sessions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ agentId: 'agent-1' }),
});
const session = await response.json();

// After (WebSocket)
import { createWebSocketClient } from '@openaidy/sdk';

const client = createWebSocketClient({
  url: 'wss://api.openaidy.com/ws',
  token,
});
await client.connect();

const session = await client.createSession({ agentId: 'agent-1' });
```

**3. Replace Message Handling**

```typescript
// Before (REST with polling)
const poll = async () => {
  const response = await fetch(`/api/sessions/${sessionId}/messages`);
  const messages = await response.json();
  // Process messages...
};

// After (WebSocket with events)
client.on('session.message', (data) => {
  // Process message immediately
});
```

**4. Handle Authentication Differences**

```typescript
// REST: Token in header per request
fetch('/api/sessions', {
  headers: { 'Authorization': `Bearer ${token}` },
});

// WebSocket: Token in connection URL
const client = createWebSocketClient({
  url: 'wss://api.openaidy.com/ws',
  token,  // Sent once during connection
});
```

**5. Handle Error Differences**

```typescript
// REST: HTTP status codes
const response = await fetch('/api/sessions');
if (!response.ok) {
  const error = await response.json();
  console.error(error.message);
}

// WebSocket: Error messages
client.onError((error) => {
  console.error(error.message);
});

// Or try-catch with requests
try {
  await client.createSession();
} catch (error) {
  console.error(error.message);
}
```

## Security Considerations

### Token Storage

**Web (Browser)**
```typescript
// ❌ Bad: localStorage is vulnerable to XSS
localStorage.setItem('token', token);

// ✅ Good: HttpOnly cookie (set by backend)
// Server sets: Set-Cookie: token=...; HttpOnly; Secure; SameSite=Strict

// ✅ Good: sessionStorage for short-lived sessions
sessionStorage.setItem('token', token);

// ✅ Good: In-memory for most secure (lost on refresh)
let token: string | null = null;
```

**Mobile**
```typescript
// React Native
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// ✅ Good: SecureStore for sensitive tokens
await SecureStore.setItemAsync('openaidy_token', token);

// ❌ Bad: AsyncStorage is not encrypted
await AsyncStorage.setItem('token', token);
```

### Secure Connections

```typescript
// ✅ Always use wss:// in production
const client = createWebSocketClient({
  url: 'wss://api.openaidy.com/ws',
});

// ❌ Never use ws:// in production
const client = createWebSocketClient({
  url: 'ws://api.openaidy.com/ws',  // Unencrypted!
});
```

### Permission Handling

```typescript
// Request minimal capabilities
const token = await getTokenWithCapabilities([
  'session.read',
  'session.write',
  'agent.read',
]);

// Don't request more than needed
const token = await getTokenWithCapabilities(['*']); // Too permissive
```

## Performance Considerations

### Connection Pooling

For services with many concurrent operations:

```typescript
class ConnectionPool {
  private connections: WebSocketClient[] = [];
  private current = 0;

  constructor(private config: { url: string; token: string; poolSize: number }) {}

  async initialize() {
    for (let i = 0; i < this.config.poolSize; i++) {
      const client = createWebSocketClient({
        url: this.config.url,
        token: this.config.token,
      });
      await client.connect();
      this.connections.push(client);
    }
  }

  getClient(): WebSocketClient {
    const client = this.connections[this.current];
    this.current = (this.current + 1) % this.connections.length;
    return client;
  }

  destroy() {
    this.connections.forEach(c => c.destroy());
  }
}
```

### Message Batching

```typescript
// ✅ Good: Batch operations
const sessions = await client.listSessions({ limit: 100 });

// ❌ Bad: Individual requests
for (const id of sessionIds) {
  await client.getSession(id);
}
```

### Event Filtering

```typescript
// ✅ Good: Filter events
await client.subscribeToSession(sessionId, ['session.message', 'session.updated']);

// ❌ Bad: Subscribe to all events
await client.subscribeToSession(sessionId);
```

## Troubleshooting

### Common Issues and Solutions

**Connection fails immediately**
- Check token validity
- Verify URL is correct (wss:// not ws://)
- Check network connectivity
- Verify server is running

**Connection drops frequently**
- Enable auto-reconnect
- Check heartbeat interval
- Verify network stability
- Check server logs

**Messages not received**
- Verify subscription is active
- Check event type spelling
- Verify session ID is correct
- Check error handlers

**Authentication fails**
- Token expired
- Invalid token format
- Missing capabilities
- Token revoked

### Debug Mode

```typescript
const client = createWebSocketClient({
  url: 'wss://api.openaidy.com/ws',
  token,
  logger: {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data),
    debug: (msg, data) => console.debug(`[DEBUG] ${msg}`, data),
  },
});
```

### Logging and Monitoring

```typescript
// Track connection state
client.onStateChange((state) => {
  analytics.track('websocket_state', { state });
});

// Track errors
client.onError((error) => {
  analytics.track('websocket_error', { error: error.message });
  Sentry.captureException(error);
});

// Track performance
const start = Date.now();
await client.createSession();
analytics.track('session_create', { duration: Date.now() - start });
```
