/**
 * OpenAidy Addon SDK
 *
 * Loaded by addon iframes. Communicates with the parent app via postMessage —
 * the addon never touches localStorage or makes direct authenticated requests.
 *
 * Usage in addon HTML:
 *   <script src="http://localhost:3001/sdk/openaidy-sdk.js"></script>
 *   <script>
 *     OpenAidy.ready(async (sdk) => {
 *       const sessions = await sdk.listSessions();
 *     });
 *   </script>
 */
(function (global) {
  'use strict';

  var SDK_VERSION = '0.3.0';
  console.log('[OpenAidy SDK] v' + SDK_VERSION + ' loaded');

  let _token = null;
  let _apiBase = null;
  let _nonce = null;
  let _ready = false;
  const _pendingRequests = new Map();
  const _readyCallbacks = [];

  // Forward CSP violations to the parent app so it can show a warning banner.
  // Violations that fire before OPENAIDY_INIT (nonce not yet known) are buffered
  // and flushed once the nonce arrives.
  var _cspViolationBuffer = [];
  function _flushCspViolations() {
    _cspViolationBuffer.forEach(function (blocked) {
      window.parent.postMessage(
        { type: 'ADDON_CSP_VIOLATION', blockedURI: blocked, nonce: _nonce },
        '*',
      );
    });
    _cspViolationBuffer = [];
  }
  document.addEventListener('securitypolicyviolation', function (e) {
    var blocked = e.blockedURI;
    if (!blocked || blocked === 'inline' || blocked === 'eval') return;
    if (_nonce) {
      window.parent.postMessage(
        { type: 'ADDON_CSP_VIOLATION', blockedURI: blocked, nonce: _nonce },
        '*',
      );
    } else {
      _cspViolationBuffer.push(blocked);
    }
  });

  // Listen for INIT message from parent
  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'OPENAIDY_INIT') {
      _token = msg.token ?? null;
      _apiBase = msg.apiBase ?? null;
      _nonce = msg.nonce ?? null;
      _ready = true;
      _flushCspViolations();
      _readyCallbacks.forEach(function (cb) {
        try {
          cb(global.OpenAidy);
        } catch (e) {
          console.error('[OpenAidy SDK] ready callback error', e);
        }
      });
      _readyCallbacks.length = 0;
      return;
    }

    if (msg.type === 'OPENAIDY_RESPONSE') {
      const pending = _pendingRequests.get(msg.requestId);
      if (!pending) return;
      _pendingRequests.delete(msg.requestId);
      if (msg.ok) {
        pending.resolve(msg.data);
      } else {
        pending.reject(new Error(msg.error ?? 'HTTP ' + msg.status));
      }
    }
  });

  // Send a proxied API request through the parent
  function request(method, path, body) {
    return new Promise(function (resolve, reject) {
      if (!_ready) {
        return reject(
          new Error(
            '[OpenAidy SDK] Not initialized yet. Use OpenAidy.ready().',
          ),
        );
      }
      const requestId = Math.random().toString(36).slice(2);
      _pendingRequests.set(requestId, { resolve, reject });
      window.parent.postMessage(
        {
          type: 'OPENAIDY_REQUEST',
          requestId,
          method,
          path,
          body,
          nonce: _nonce,
        },
        '*',
      );
      // Timeout after 15s
      setTimeout(function () {
        if (_pendingRequests.has(requestId)) {
          _pendingRequests.delete(requestId);
          reject(new Error('[OpenAidy SDK] Request timed out: ' + path));
        }
      }, 15000);
    });
  }

  const sdk = {
    /** Register a callback to run once the SDK is initialized with a token */
    ready: function (cb) {
      if (_ready) {
        try {
          cb(sdk);
        } catch (e) {
          console.error('[OpenAidy SDK] ready callback error', e);
        }
      } else {
        _readyCallbacks.push(cb);
      }
    },

    // ── Sessions ──────────────────────────────────────────────────────────
    listSessions: function () {
      return request('GET', '/api/addon-proxy/sessions');
    },
    sendMessage: function (sessionId, content, agentId) {
      return request(
        'POST',
        '/api/addon-proxy/sessions/' + sessionId + '/messages',
        { content: content, agentId: agentId },
      );
    },
    getSession: function (sessionId) {
      return request('GET', '/api/addon-proxy/sessions/' + sessionId);
    },

    // ── Agents ────────────────────────────────────────────────────────────
    listAgents: function () {
      return request('GET', '/api/addon-proxy/agents');
    },
    invokeAgent: function (agentId, input, context) {
      return request('POST', '/api/addon-proxy/agents/' + agentId + '/invoke', {
        input: input,
        context: context ?? {},
      });
    },

    // ── Config ────────────────────────────────────────────────────────────
    getConfig: function (namespace) {
      return request(
        'GET',
        '/api/addon-proxy/config/' + (namespace ?? 'default'),
      );
    },

    // ── Storage (per-addon SQLite) ────────────────────────────────────────
    // Requires the `storage.read` / `storage.write` permissions. Schema is
    // declared in the manifest under `storage.migrations`.
    storage: {
      kv: {
        /** Read a JSON value by key (resolves undefined if absent). */
        get: function (key) {
          return request(
            'GET',
            '/api/addon-proxy/storage/kv/' + encodeURIComponent(key),
          ).then(function (r) {
            return r.value;
          });
        },
        /** Write a JSON value by key. */
        set: function (key, value) {
          return request(
            'PUT',
            '/api/addon-proxy/storage/kv/' + encodeURIComponent(key),
            { value: value },
          );
        },
        /** List {key, value} entries, optionally filtered by key prefix. */
        list: function (prefix) {
          return request(
            'GET',
            '/api/addon-proxy/storage/kv' +
              (prefix ? '?prefix=' + encodeURIComponent(prefix) : ''),
          ).then(function (r) {
            return r.items;
          });
        },
        /** Delete a key; resolves true if a row was removed. */
        delete: function (key) {
          return request(
            'DELETE',
            '/api/addon-proxy/storage/kv/' + encodeURIComponent(key),
          ).then(function (r) {
            return r.deleted;
          });
        },
      },
      /** Run a read query (SELECT/…); resolves an array of row objects. */
      query: function (sql, params) {
        return request('POST', '/api/addon-proxy/storage/query', {
          sql: sql,
          params: params,
        }).then(function (r) {
          return r.rows;
        });
      },
      /** Run a write statement; resolves {changes, lastInsertRowid}. */
      exec: function (sql, params) {
        return request('POST', '/api/addon-proxy/storage/exec', {
          sql: sql,
          params: params,
        });
      },
      /** Full-text search over a declared FTS5 table; resolves matching rows. */
      search: function (table, match, limit) {
        return request('POST', '/api/addon-proxy/storage/search', {
          table: table,
          match: match,
          limit: limit,
        }).then(function (r) {
          return r.rows;
        });
      },
    },

    // ── Raw request (escape hatch) ────────────────────────────────────────
    request: function (method, path, body) {
      return request(method, path, body);
    },
  };

  global.OpenAidy = sdk;
})(typeof window !== 'undefined' ? window : globalThis);
