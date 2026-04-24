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

  var SDK_VERSION = '0.2.0';
  console.log('[OpenAidy SDK] v' + SDK_VERSION + ' loaded');

  let _token = null;
  let _apiBase = null;
  let _parentOrigin = null;
  let _ready = false;
  const _pendingRequests = new Map();
  const _readyCallbacks = [];

  // Listen for INIT message from parent
  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'OPENAIDY_INIT') {
      _token = msg.token ?? null;
      _apiBase = msg.apiBase ?? null;
      _parentOrigin = msg.parentOrigin ?? null;
      _ready = true;
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
        { type: 'OPENAIDY_REQUEST', requestId, method, path, body },
        _parentOrigin ?? '*',
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
      return request('GET', '/sessions');
    },
    createSession: function (title) {
      return request('POST', '/sessions', {
        title: title ?? 'New Session',
      });
    },
    getSession: function (sessionId) {
      return request('GET', '/sessions/' + sessionId);
    },

    // ── Agents ────────────────────────────────────────────────────────────
    listAgents: function () {
      return request('GET', '/agents');
    },
    invokeAgent: function (agentId, input, context) {
      return request('POST', '/api/addon-proxy/agents/' + agentId + '/invoke', {
        input: input,
        context: context ?? {},
      });
    },

    // ── Config ────────────────────────────────────────────────────────────
    getConfig: function () {
      return request('GET', '/config');
    },

    // ── Raw request (escape hatch) ────────────────────────────────────────
    request: function (method, path, body) {
      return request(method, path, body);
    },
  };

  global.OpenAidy = sdk;
})(typeof window !== 'undefined' ? window : globalThis);
