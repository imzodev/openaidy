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

  var SDK_VERSION = '0.3.1';
  console.log('[OpenAidy SDK] v' + SDK_VERSION + ' loaded');

  let _apiBase = null;
  let _nonce = null;
  let _ready = false;
  const _pendingRequests = new Map();
  const _readyCallbacks = [];

  // ── Host theme sync ─────────────────────────────────────────────────────
  // Every addon that loads this file — whether scaffolded via `openaidy
  // addon create` or generated ad hoc by an agent — should follow the host
  // app's light/dark theme instead of carrying its own. The host
  // (AddonViewPage) posts OPENAIDY_INIT once on load and OPENAIDY_THEME_CHANGED
  // whenever the user toggles the theme; applyTheme() mirrors both onto this
  // document so an addon using Tailwind `dark:` classes (the common case,
  // since addon_create injects the Tailwind CDN) or referencing the
  // `--bg-primary`/`--text-primary`/etc. CSS custom properties tracks the
  // host automatically, live, with no addon-authored code required.
  //
  // Fallback tokens mirror the host's dark palette (apps/web/src/index.css)
  // so an addon that paints before OPENAIDY_INIT arrives still looks
  // reasonable instead of flashing unstyled/default browser colors.
  var FALLBACK_THEME_TOKENS = {
    '--primary': '#3b82f6',
    '--primary-hover': '#2563eb',
    '--primary-disabled': '#93c5fd',
    '--danger': '#ef4444',
    '--success': '#22c55e',
    '--text-primary': '#f3f4f6',
    '--text-secondary': '#d1d5db',
    '--text-tertiary': '#9ca3af',
    '--text-muted': '#6b7280',
    '--text-inverse': '#f9fafb',
    '--bg-primary': '#111827',
    '--bg-secondary': '#1f2937',
    '--bg-tertiary': '#374151',
    '--bg-elevated': '#1f2937',
    '--border-primary': '#374151',
    '--border-secondary': '#4b5563',
  };

  function _applyTheme(theme) {
    if (!theme) return;
    var tokens = theme.tokens || {};
    var root = document.documentElement;
    var keys = Object.keys(FALLBACK_THEME_TOKENS);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      root.style.setProperty(k, tokens[k] || FALLBACK_THEME_TOKENS[k]);
    }
    // Tailwind's `dark:` variants (and the SDK's own sdk.ui.* components,
    // which use them) key off this class — mirror the host's so they
    // resolve correctly inside the iframe.
    if (theme.mode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }

  // Paint something reasonable immediately, before OPENAIDY_INIT arrives.
  _applyTheme({ mode: 'dark', tokens: FALLBACK_THEME_TOKENS });

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
      // The host sends OPENAIDY_INIT more than once by design (on iframe
      // load, then again on ADDON_READY) — apply the theme every time
      // rather than gating it on `_ready`, since a later INIT can carry a
      // newer palette than the first.
      _applyTheme(msg.theme);
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

    if (msg.type === 'OPENAIDY_THEME_CHANGED') {
      // Live update: fires whenever the user toggles the host's theme
      // while the addon is open, so it follows without a reload.
      _applyTheme(msg.theme);
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

  // Timing safety: the host also sends OPENAIDY_INIT on the iframe's `load`
  // event as a fallback, but that can race with slower-loading addon pages.
  // Signaling readiness explicitly once this script has registered its
  // listener guarantees a prompt (re-)INIT — receiving it twice is safe
  // (see above).
  window.parent.postMessage({ type: 'ADDON_READY' }, '*');

  // Default timeout for quick proxied calls (list/get/storage). Kept short so
  // a genuinely lost response surfaces fast rather than hanging the UI.
  var DEFAULT_REQUEST_TIMEOUT_MS = 15000;
  // Timeout for agent-invoking calls (invokeAgent, sendMessage). These block on
  // a full LLM run server-side and routinely take 30s–150s+, so the short
  // default would reject a request that actually succeeds. A generous ceiling
  // still guards against a truly hung run / lost response.
  var AGENT_REQUEST_TIMEOUT_MS = 300000; // 5 minutes

  // Send a proxied API request through the parent. `timeoutMs` overrides the
  // default for long-running calls.
  function request(method, path, body, timeoutMs) {
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
      setTimeout(function () {
        if (_pendingRequests.has(requestId)) {
          _pendingRequests.delete(requestId);
          reject(new Error('[OpenAidy SDK] Request timed out: ' + path));
        }
      }, timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
    });
  }

  // ── UI helpers (internal — not exposed on sdk.ui) ──────────────────────
  // Small, reused primitives so the 25 sdk.ui.* components below stay DRY.
  var _uid = 0;
  function _nextId(prefix) {
    return (prefix || 'oa') + '-' + ++_uid;
  }

  /** classnames-style joiner: filters falsy args, joins the rest with a space. */
  function _cx() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i]) parts.push(arguments[i]);
    }
    return parts.join(' ');
  }

  /** Append a string, element, or array of either onto a parent node. */
  function _append(parent, children) {
    var list = Array.isArray(children) ? children : [children];
    list.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      parent.appendChild(
        typeof c === 'string' ? document.createTextNode(c) : c,
      );
    });
    return parent;
  }

  /**
   * Create an element with a className, attribute/event map, and children.
   * `attrs` keys starting with "on" (e.g. onClick) are wired as
   * addEventListener(type, handler); everything else is setAttribute.
   */
  function _el(tag, className, attrs, children) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null) return;
        if (/^on[A-Z]/.test(k) && typeof v === 'function') {
          e.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'text') {
          e.textContent = v;
        } else if (typeof v === 'boolean') {
          if (v) e.setAttribute(k, '');
        } else {
          e.setAttribute(k, v);
        }
      });
    }
    if (children !== undefined) _append(e, children);
    return e;
  }

  // Tailwind utility fragments shared across components — kept here once so
  // every component's focus ring / disabled state / transition looks the same.
  var _FOCUS_RING =
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-500';
  var _TRANSITION = 'transition-colors duration-150';

  var _VARIANT_CLASSES = {
    primary: 'bg-sky-600 text-white hover:bg-sky-700',
    secondary:
      'bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600',
    ghost:
      'bg-transparent text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  var _SIZE_CLASSES = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-3.5 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  };
  var _BADGE_COLOR_CLASSES = {
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    green:
      'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    gray: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    yellow:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  };
  var _ALERT_VARIANT_CLASSES = {
    info: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-800',
    success:
      'bg-green-50 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800',
    warning:
      'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-200 dark:border-yellow-800',
    error:
      'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800',
  };

  /** A simple inline SVG spinner used by button() loading states. */
  function _spinnerSvg() {
    var span = _el(
      'span',
      'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
      { 'aria-hidden': 'true' },
    );
    return span;
  }

  /**
   * Trap Tab/Shift+Tab focus within `container` and close on Escape. Returns a
   * cleanup function that removes the listener — callers MUST call it when the
   * container is dismissed/removed to avoid leaking a document-level listener.
   */
  function _trapFocus(container, onEscape) {
    var previouslyFocused = document.activeElement;
    function focusables() {
      return Array.prototype.slice
        .call(
          container.querySelectorAll(
            'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])',
          ),
        )
        .filter(function (el) {
          return !el.disabled && !el.hidden;
        });
    }
    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (onEscape) onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      var items = focusables();
      if (items.length === 0) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeydown, true);
    var initial = focusables()[0];
    if (initial) initial.focus();
    return function cleanup() {
      document.removeEventListener('keydown', onKeydown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }

  /** Lazily create (once) and return the fixed toast-stack container. */
  var _toastContainer = null;
  function _getToastContainer() {
    if (_toastContainer && document.body.contains(_toastContainer)) {
      return _toastContainer;
    }
    _toastContainer = _el(
      'div',
      'fixed top-4 right-4 z-50 flex flex-col gap-2 w-80',
      { role: 'region', 'aria-label': 'Notifications' },
    );
    document.body.appendChild(_toastContainer);
    return _toastContainer;
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
      // Runs the agent to completion server-side — allow the long timeout.
      return request(
        'POST',
        '/api/addon-proxy/sessions/' + sessionId + '/messages',
        { content: content, agentId: agentId },
        AGENT_REQUEST_TIMEOUT_MS,
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
      // Blocks on a full LLM run server-side — allow the long timeout.
      return request(
        'POST',
        '/api/addon-proxy/agents/' + agentId + '/invoke',
        {
          input: input,
          context: context ?? {},
        },
        AGENT_REQUEST_TIMEOUT_MS,
      );
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

    // ── UI (Tailwind-styled component library) ─────────────────────────────
    // Pure client-side DOM builders — no server round-trip, no permission
    // required. Every component returns a real HTMLElement so it can be
    // manipulated after creation. See GET /sdk/components.json for a
    // machine-readable manifest of this namespace.
    ui: {
      /**
       * @component
       * @namespace sdk.ui
       * @description A styled card container with a title and optional subtitle.
       * @param {string} title - The card title
       * @param {string} [subtitle] - Optional subtitle text
       * @param {HTMLElement|string} [children] - Content to render inside the card
       * @param {string} [class] - Extra Tailwind classes to merge onto the container
       * @returns {HTMLElement}
       */
      card: function (opts) {
        opts = opts || {};
        var root = _el(
          'div',
          _cx(
            'rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800',
            opts['class'],
          ),
        );
        if (opts.title) {
          _append(
            root,
            _el(
              'h3',
              'text-base font-semibold text-gray-900 dark:text-gray-100',
              {
                text: opts.title,
              },
            ),
          );
        }
        if (opts.subtitle) {
          _append(
            root,
            _el('p', 'mt-1 text-sm text-gray-500 dark:text-gray-400', {
              text: opts.subtitle,
            }),
          );
        }
        if (opts.children !== undefined) {
          var body = _el('div', (opts.title || opts.subtitle) && 'mt-4');
          _append(body, opts.children);
          _append(root, body);
        }
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A tabbed panel with keyboard navigation (Left/Right arrow keys).
       * @param {Array} tabs - Array of { id, label, content: HTMLElement|string }
       * @param {string} [activeTab] - id of the initially active tab (defaults to the first)
       * @param {string} [class] - Extra Tailwind classes to merge onto the container
       * @returns {HTMLElement}
       */
      tabs: function (opts) {
        opts = opts || {};
        var items = opts.tabs || [];
        var groupId = _nextId('tabs');
        var active = opts.activeTab || (items[0] && items[0].id);

        var root = _el('div', _cx('w-full', opts['class']));
        var tablist = _el(
          'div',
          'flex gap-1 border-b border-gray-200 dark:border-gray-700',
          {
            role: 'tablist',
          },
        );
        var panelHost = _el('div', 'py-4');

        var buttons = {};
        function renderPanel() {
          panelHost.innerHTML = '';
          var current = items.filter(function (t) {
            return t.id === active;
          })[0];
          if (current) _append(panelHost, current.content);
        }
        function activate(id) {
          active = id;
          items.forEach(function (t) {
            var btn = buttons[t.id];
            var selected = t.id === id;
            btn.setAttribute('aria-selected', String(selected));
            btn.tabIndex = selected ? 0 : -1;
            btn.className = _cx(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px',
              _TRANSITION,
              selected
                ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
            );
          });
          renderPanel();
        }

        items.forEach(function (t, index) {
          var btn = _el(
            'button',
            '',
            {
              type: 'button',
              role: 'tab',
              id: groupId + '-tab-' + t.id,
              'aria-controls': groupId + '-panel-' + t.id,
              onClick: function () {
                activate(t.id);
                btn.focus();
              },
              onKeydown: function (e) {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                var dir = e.key === 'ArrowRight' ? 1 : -1;
                var nextIndex = (index + dir + items.length) % items.length;
                var nextTab = items[nextIndex];
                activate(nextTab.id);
                buttons[nextTab.id].focus();
              },
            },
            t.label,
          );
          buttons[t.id] = btn;
          _append(tablist, btn);
        });

        activate(active);
        _append(root, [tablist, panelHost]);
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A vertically-stacked accordion of expandable items.
       * @param {Array} items - Array of { title, content: HTMLElement|string }
       * @param {boolean} [multiple] - Allow more than one item open at once (default false)
       * @param {string} [class] - Extra Tailwind classes to merge onto the container
       * @returns {HTMLElement}
       */
      accordion: function (opts) {
        opts = opts || {};
        var items = opts.items || [];
        var multiple = !!opts.multiple;
        var root = _el(
          'div',
          _cx(
            'divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700',
            opts['class'],
          ),
        );
        var panels = [];

        items.forEach(function (item, index) {
          var panelId = _nextId('accordion-panel');
          var panel = _el(
            'div',
            'hidden px-4 pb-4 text-sm text-gray-600 dark:text-gray-300',
            { id: panelId, role: 'region' },
          );
          _append(panel, item.content);
          panels.push(panel);

          var chevron = _el('span', 'transition-transform duration-150', {
            'aria-hidden': 'true',
            text: '›',
          });
          var btn = _el(
            'button',
            'flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800/60',
            {
              type: 'button',
              'aria-expanded': 'false',
              'aria-controls': panelId,
              onClick: function () {
                var willOpen = panel.classList.contains('hidden');
                if (willOpen && !multiple) {
                  panels.forEach(function (p, i) {
                    if (i === index) return;
                    p.classList.add('hidden');
                    if (p.previousSibling) {
                      p.previousSibling.setAttribute('aria-expanded', 'false');
                    }
                  });
                }
                panel.classList.toggle('hidden', !willOpen);
                btn.setAttribute('aria-expanded', String(willOpen));
                chevron.style.transform = willOpen ? 'rotate(90deg)' : '';
              },
            },
            [item.title, chevron],
          );
          _append(root, [btn, panel]);
        });
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A thin horizontal or vertical divider line.
       * @param {string} [orientation] - "horizontal" (default) or "vertical"
       * @param {string} [class] - Extra Tailwind classes to merge onto the element
       * @returns {HTMLElement}
       */
      separator: function (opts) {
        opts = opts || {};
        var vertical = opts.orientation === 'vertical';
        return _el(
          'div',
          _cx(
            'border-gray-200 dark:border-gray-700',
            vertical ? 'inline-block h-full w-px border-l' : 'w-full border-t',
            opts['class'],
          ),
          {
            role: 'separator',
            'aria-orientation': vertical ? 'vertical' : 'horizontal',
          },
        );
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A clickable button with variants, sizes, an optional icon, and loading/disabled states.
       * @param {string} text - Button label
       * @param {string} [variant] - "primary" (default), "secondary", "ghost", or "danger"
       * @param {string} [size] - "sm", "md" (default), or "lg"
       * @param {HTMLElement|string} [icon] - Icon rendered before the label
       * @param {Function} [onClick] - Click handler
       * @param {boolean} [disabled] - Disable the button
       * @param {boolean} [loading] - Show a spinner and disable the button
       * @param {string} [class] - Extra Tailwind classes to merge onto the button
       * @returns {HTMLElement}
       */
      button: function (opts) {
        opts = opts || {};
        var variant = _VARIANT_CLASSES[opts.variant] ? opts.variant : 'primary';
        var size = _SIZE_CLASSES[opts.size] ? opts.size : 'md';
        var isDisabled = !!opts.disabled || !!opts.loading;
        var btn = _el(
          'button',
          _cx(
            'inline-flex items-center justify-center rounded-lg font-medium',
            _TRANSITION,
            _FOCUS_RING,
            _VARIANT_CLASSES[variant],
            _SIZE_CLASSES[size],
            isDisabled && 'opacity-50 cursor-not-allowed',
            opts['class'],
          ),
          {
            type: 'button',
            disabled: isDisabled,
            onClick: isDisabled
              ? undefined
              : function (e) {
                  if (opts.onClick) opts.onClick(e);
                },
          },
        );
        if (opts.loading) _append(btn, _spinnerSvg());
        else if (opts.icon !== undefined) _append(btn, opts.icon);
        _append(btn, _el('span', '', { text: opts.text }));
        return btn;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A visually grouped set of buttons with shared borders.
       * @param {Array} buttons - Array of { text, variant, onClick }
       * @param {string} [orientation] - "horizontal" (default) or "vertical"
       * @param {string} [class] - Extra Tailwind classes to merge onto the container
       * @returns {HTMLElement}
       */
      buttonGroup: function (opts) {
        opts = opts || {};
        var items = opts.buttons || [];
        var vertical = opts.orientation === 'vertical';
        var root = _el(
          'div',
          _cx('inline-flex', vertical ? 'flex-col' : 'flex-row', opts['class']),
        );
        items.forEach(function (b, i) {
          var el = sdk.ui.button({
            text: b.text,
            variant: b.variant,
            onClick: b.onClick,
            disabled: b.disabled,
            class: _cx(
              vertical ? 'rounded-none w-full' : 'rounded-none',
              i === 0 && (vertical ? 'rounded-t-lg' : 'rounded-l-lg'),
              i === items.length - 1 &&
                (vertical ? 'rounded-b-lg' : 'rounded-r-lg'),
              i > 0 && (vertical ? '-mt-px' : '-ml-px'),
            ),
          });
          _append(root, el);
        });
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A trigger button that opens a menu of clickable items; closes on outside click, item selection, or Escape.
       * @param {HTMLElement|string} trigger - The element or label that opens the menu
       * @param {Array} items - Array of { label, onClick, icon: HTMLElement|string }
       * @returns {HTMLElement}
       */
      dropdownMenu: function (opts) {
        opts = opts || {};
        var items = opts.items || [];
        var root = _el('div', 'relative inline-block');
        var triggerBtn =
          typeof opts.trigger === 'string'
            ? sdk.ui.button({ text: opts.trigger })
            : opts.trigger;
        triggerBtn.setAttribute('aria-haspopup', 'menu');
        triggerBtn.setAttribute('aria-expanded', 'false');

        var menu = _el(
          'div',
          'absolute left-0 z-10 mt-1 hidden min-w-[10rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800',
          { role: 'menu' },
        );

        function close() {
          menu.classList.add('hidden');
          triggerBtn.setAttribute('aria-expanded', 'false');
          document.removeEventListener('click', onDocClick, true);
          document.removeEventListener('keydown', onKeydown, true);
        }
        function open() {
          menu.classList.remove('hidden');
          triggerBtn.setAttribute('aria-expanded', 'true');
          document.addEventListener('click', onDocClick, true);
          document.addEventListener('keydown', onKeydown, true);
        }
        function onDocClick(e) {
          if (!root.contains(e.target)) close();
        }
        function onKeydown(e) {
          if (e.key === 'Escape') {
            close();
            triggerBtn.focus();
          }
        }
        triggerBtn.addEventListener('click', function () {
          if (menu.classList.contains('hidden')) open();
          else close();
        });

        items.forEach(function (item) {
          var itemEl = _el(
            'button',
            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
            {
              type: 'button',
              role: 'menuitem',
              onClick: function (e) {
                close();
                if (item.onClick) item.onClick(e);
              },
            },
            [item.icon, item.label],
          );
          _append(menu, itemEl);
        });

        _append(root, [triggerBtn, menu]);
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A data table with an empty state and optional row-click handling.
       * @param {Array} columns - Array of { key, label }
       * @param {Array} rows - Array of row objects keyed by column key
       * @param {Function} [onRowClick] - Called with the row object when a row is clicked
       * @param {string} [class] - Extra Tailwind classes to merge onto the table
       * @returns {HTMLElement}
       */
      table: function (opts) {
        opts = opts || {};
        var columns = opts.columns || [];
        var rows = opts.rows || [];
        var table = _el(
          'table',
          _cx('w-full text-left text-sm', opts['class']),
        );
        var thead = _el(
          'thead',
          'border-b border-gray-200 dark:border-gray-700',
        );
        var headRow = _el('tr');
        columns.forEach(function (c) {
          _append(
            headRow,
            _el(
              'th',
              'px-3 py-2 font-medium text-gray-500 dark:text-gray-400',
              { scope: 'col', text: c.label },
            ),
          );
        });
        _append(thead, headRow);

        var tbody = _el(
          'tbody',
          'divide-y divide-gray-100 dark:divide-gray-800',
        );
        if (rows.length === 0) {
          var emptyRow = _el('tr');
          _append(
            emptyRow,
            _el(
              'td',
              'px-3 py-6 text-center text-gray-400 dark:text-gray-500',
              { colspan: String(columns.length || 1), text: 'No data' },
            ),
          );
          _append(tbody, emptyRow);
        } else {
          rows.forEach(function (row) {
            var tr = _el(
              'tr',
              _cx(
                'text-gray-700 dark:text-gray-200',
                opts.onRowClick &&
                  'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60',
              ),
              opts.onRowClick && {
                onClick: function () {
                  opts.onRowClick(row);
                },
              },
            );
            columns.forEach(function (c) {
              _append(tr, _el('td', 'px-3 py-2', { text: row[c.key] }));
            });
            _append(tbody, tr);
          });
        }
        _append(table, [thead, tbody]);
        return table;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A small colored label for status/tags.
       * @param {string} text - Badge text
       * @param {string} [color] - "blue" (default), "green", "red", "gray", or "yellow"
       * @returns {HTMLElement}
       */
      badge: function (opts) {
        opts = opts || {};
        var color = _BADGE_COLOR_CLASSES[opts.color] ? opts.color : 'blue';
        return _el(
          'span',
          _cx(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
            _BADGE_COLOR_CLASSES[color],
          ),
          { text: opts.text },
        );
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A circular avatar image with a text fallback when no image loads.
       * @param {string} [src] - Image URL
       * @param {string} [alt] - Alt text for the image
       * @param {string} [fallback] - Fallback text (e.g. initials) shown when there is no image
       * @param {string} [size] - "sm", "md" (default), or "lg"
       * @returns {HTMLElement}
       */
      avatar: function (opts) {
        opts = opts || {};
        var sizeClasses = {
          sm: 'h-6 w-6 text-xs',
          md: 'h-10 w-10 text-sm',
          lg: 'h-14 w-14 text-lg',
        };
        var size = sizeClasses[opts.size] ? opts.size : 'md';
        var root = _el(
          'span',
          _cx(
            'inline-flex items-center justify-center overflow-hidden rounded-full bg-gray-200 font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300',
            sizeClasses[size],
          ),
        );
        if (opts.src) {
          var img = _el('img', 'h-full w-full object-cover', {
            src: opts.src,
            alt: opts.alt || '',
            onError: function () {
              img.remove();
              _append(
                root,
                _el('span', '', { text: (opts.fallback || '?').slice(0, 2) }),
              );
            },
          });
          _append(root, img);
        } else {
          _append(
            root,
            _el('span', '', { text: (opts.fallback || '?').slice(0, 2) }),
          );
        }
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A pulsing placeholder shown while content is loading.
       * @param {string} [width] - CSS width (default "100%")
       * @param {string} [height] - CSS height (default "1rem")
       * @param {string} [variant] - "text" (default, rounded bar), "circle", or "rect"
       * @returns {HTMLElement}
       */
      skeleton: function (opts) {
        opts = opts || {};
        var variant = opts.variant || 'text';
        var shape =
          variant === 'circle'
            ? 'rounded-full'
            : variant === 'rect'
              ? 'rounded-md'
              : 'rounded';
        var el = _el(
          'div',
          _cx('animate-pulse bg-gray-200 dark:bg-gray-700', shape),
          { 'aria-hidden': 'true' },
        );
        el.style.width = opts.width || '100%';
        el.style.height =
          opts.height || (variant === 'text' ? '1rem' : '2.5rem');
        return el;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A breadcrumb trail of navigation items.
       * @param {Array} items - Array of { label, href, onClick }
       * @returns {HTMLElement}
       */
      breadcrumb: function (opts) {
        opts = opts || {};
        var items = opts.items || [];
        var nav = _el('nav', '', { 'aria-label': 'Breadcrumb' });
        var ol = _el('ol', 'flex items-center gap-1.5 text-sm');
        items.forEach(function (item, index) {
          var isLast = index === items.length - 1;
          var li = _el('li', 'flex items-center gap-1.5');
          var content;
          if (isLast) {
            content = _el(
              'span',
              'font-medium text-gray-900 dark:text-gray-100',
              { text: item.label, 'aria-current': 'page' },
            );
          } else if (item.href) {
            content = _el(
              'a',
              'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
              { href: item.href, text: item.label },
            );
          } else {
            content = _el(
              'button',
              'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
              { type: 'button', text: item.label, onClick: item.onClick },
            );
          }
          _append(li, content);
          if (!isLast) {
            _append(
              li,
              _el('span', 'text-gray-400 dark:text-gray-600', {
                'aria-hidden': 'true',
                text: '/',
              }),
            );
          }
          _append(ol, li);
        });
        _append(nav, ol);
        return nav;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description Shows a transient stacked notification in the top-right corner; auto-dismisses after `duration`.
       * @param {string} message - Toast message
       * @param {string} [type] - "info" (default), "success", "error", or "warning"
       * @param {number} [duration] - Auto-dismiss delay in ms (default 4000; pass 0 to disable)
       * @returns {HTMLElement}
       */
      toast: function (opts) {
        opts = opts || {};
        var type = _ALERT_VARIANT_CLASSES[opts.type] ? opts.type : 'info';
        var duration = opts.duration === undefined ? 4000 : opts.duration;
        var container = _getToastContainer();

        var timeoutId;
        var el = _el(
          'div',
          _cx(
            'flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-md',
            _ALERT_VARIANT_CLASSES[type],
          ),
          { role: 'status', 'aria-live': 'polite' },
        );
        function dismiss() {
          if (timeoutId) clearTimeout(timeoutId);
          if (el.parentNode) el.parentNode.removeChild(el);
        }
        _append(el, [
          _el('span', '', { text: opts.message }),
          _el(
            'button',
            'shrink-0 rounded text-current opacity-60 hover:opacity-100',
            {
              type: 'button',
              'aria-label': 'Dismiss',
              onClick: dismiss,
              text: '×',
            },
          ),
        ]);
        _append(container, el);
        if (duration > 0) timeoutId = setTimeout(dismiss, duration);
        return el;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description An inline banner for important messages, with an optional dismiss button.
       * @param {string} message - Alert message
       * @param {string} [variant] - "info" (default), "success", "warning", or "error"
       * @param {string} [title] - Optional bold title shown above the message
       * @param {boolean} [dismissible] - Show a close button that removes the alert
       * @returns {HTMLElement}
       */
      alert: function (opts) {
        opts = opts || {};
        var variant = _ALERT_VARIANT_CLASSES[opts.variant]
          ? opts.variant
          : 'info';
        var root = _el(
          'div',
          _cx(
            'flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
            _ALERT_VARIANT_CLASSES[variant],
          ),
          { role: variant === 'error' ? 'alert' : 'status' },
        );
        var textWrap = _el('div', '');
        if (opts.title) {
          _append(textWrap, _el('p', 'font-semibold', { text: opts.title }));
        }
        _append(
          textWrap,
          _el('p', opts.title ? 'mt-0.5' : '', { text: opts.message }),
        );
        _append(root, textWrap);
        if (opts.dismissible) {
          _append(
            root,
            _el(
              'button',
              'shrink-0 rounded text-current opacity-60 hover:opacity-100',
              {
                type: 'button',
                'aria-label': 'Dismiss',
                onClick: function () {
                  root.remove();
                },
                text: '×',
              },
            ),
          );
        }
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A focus-trapped modal dialog with a backdrop; closes on Escape, backdrop click, or Cancel/close.
       * @param {string} title - Dialog title
       * @param {HTMLElement|string} content - Dialog body content
       * @param {Array} [buttons] - Array of { text, variant, onClick } rendered in the footer
       * @param {Function} [onClose] - Called when the dialog is dismissed (any method)
       * @returns {HTMLElement}
       */
      dialog: function (opts) {
        opts = opts || {};
        var titleId = _nextId('dialog-title');
        var backdrop = _el(
          'div',
          'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4',
        );
        var panel = _el(
          'div',
          'w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800',
          { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        );

        var cleanupFocus;
        function close() {
          if (cleanupFocus) cleanupFocus();
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          if (opts.onClose) opts.onClose();
        }

        _append(
          panel,
          _el('h2', 'text-lg font-semibold text-gray-900 dark:text-gray-100', {
            id: titleId,
            text: opts.title,
          }),
        );
        var body = _el('div', 'mt-3 text-sm text-gray-600 dark:text-gray-300');
        _append(body, opts.content);
        _append(panel, body);

        if (opts.buttons && opts.buttons.length > 0) {
          var footer = _el('div', 'mt-6 flex justify-end gap-2');
          opts.buttons.forEach(function (b) {
            _append(
              footer,
              sdk.ui.button({
                text: b.text,
                variant: b.variant,
                onClick: function (e) {
                  if (b.onClick) b.onClick(e);
                  close();
                },
              }),
            );
          });
          _append(panel, footer);
        }

        backdrop.addEventListener('click', function (e) {
          if (e.target === backdrop) close();
        });
        _append(backdrop, panel);
        document.body.appendChild(backdrop);
        cleanupFocus = _trapFocus(panel, close);
        return backdrop;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description Wraps `children` with a hover/focus-triggered tooltip bubble.
       * @param {string} content - Tooltip text
       * @param {HTMLElement} children - The element the tooltip is attached to
       * @param {string} [position] - "top" (default), "bottom", "left", or "right"
       * @returns {HTMLElement}
       */
      tooltip: function (opts) {
        opts = opts || {};
        var position = opts.position || 'top';
        var posClasses = {
          top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
          bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
          left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
          right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
        };
        var tipId = _nextId('tooltip');
        var wrapper = _el('span', 'relative inline-block');
        var bubble = _el(
          'span',
          _cx(
            'pointer-events-none absolute z-20 hidden whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white dark:bg-gray-700',
            posClasses[position] || posClasses.top,
          ),
          { id: tipId, role: 'tooltip', text: opts.content },
        );
        function show() {
          bubble.classList.remove('hidden');
        }
        function hide() {
          bubble.classList.add('hidden');
        }
        opts.children.addEventListener('mouseenter', show);
        opts.children.addEventListener('mouseleave', hide);
        opts.children.addEventListener('focus', show);
        opts.children.addEventListener('blur', hide);
        opts.children.setAttribute('aria-describedby', tipId);
        _append(wrapper, [opts.children, bubble]);
        return wrapper;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A labeled text input.
       * @param {string} [label] - Label text shown above the input
       * @param {string} [placeholder] - Placeholder text
       * @param {string} [type] - HTML input type (default "text")
       * @param {string} [value] - Initial value
       * @param {Function} [onChange] - Called with the new string value on every input event
       * @param {boolean} [disabled] - Disable the input
       * @returns {HTMLElement}
       */
      input: function (opts) {
        opts = opts || {};
        var id = _nextId('input');
        var root = _el('div', '');
        if (opts.label) {
          _append(
            root,
            _el(
              'label',
              'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300',
              {
                for: id,
                text: opts.label,
              },
            ),
          );
        }
        _append(
          root,
          _el(
            'input',
            _cx(
              'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100',
              _FOCUS_RING,
              opts.disabled &&
                'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800',
            ),
            {
              id: id,
              type: opts.type || 'text',
              placeholder: opts.placeholder,
              value: opts.value,
              disabled: !!opts.disabled,
              onInput: function (e) {
                if (opts.onChange) opts.onChange(e.target.value);
              },
            },
          ),
        );
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A labeled multi-line text input.
       * @param {string} [label] - Label text shown above the textarea
       * @param {string} [placeholder] - Placeholder text
       * @param {string} [value] - Initial value
       * @param {number} [rows] - Number of visible rows (default 3)
       * @param {Function} [onChange] - Called with the new string value on every input event
       * @param {boolean} [disabled] - Disable the textarea
       * @returns {HTMLElement}
       */
      textarea: function (opts) {
        opts = opts || {};
        var id = _nextId('textarea');
        var root = _el('div', '');
        if (opts.label) {
          _append(
            root,
            _el(
              'label',
              'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300',
              {
                for: id,
                text: opts.label,
              },
            ),
          );
        }
        var ta = _el(
          'textarea',
          _cx(
            'w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100',
            _FOCUS_RING,
            opts.disabled &&
              'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800',
          ),
          {
            id: id,
            rows: String(opts.rows || 3),
            placeholder: opts.placeholder,
            disabled: !!opts.disabled,
            onInput: function (e) {
              if (opts.onChange) opts.onChange(e.target.value);
            },
          },
        );
        if (opts.value) ta.value = opts.value;
        _append(root, ta);
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A labeled dropdown select.
       * @param {string} [label] - Label text shown above the select
       * @param {Array} options - Array of { value, label }
       * @param {string} [value] - Initially selected value
       * @param {Function} [onChange] - Called with the new string value on change
       * @param {boolean} [disabled] - Disable the select
       * @returns {HTMLElement}
       */
      select: function (opts) {
        opts = opts || {};
        var id = _nextId('select');
        var root = _el('div', '');
        if (opts.label) {
          _append(
            root,
            _el(
              'label',
              'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300',
              {
                for: id,
                text: opts.label,
              },
            ),
          );
        }
        var select = _el(
          'select',
          _cx(
            'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100',
            _FOCUS_RING,
            opts.disabled &&
              'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800',
          ),
          {
            id: id,
            disabled: !!opts.disabled,
            onChange: function (e) {
              if (opts.onChange) opts.onChange(e.target.value);
            },
          },
        );
        (opts.options || []).forEach(function (o) {
          var optionEl = _el('option', '', { value: o.value, text: o.label });
          if (o.value === opts.value) optionEl.selected = true;
          _append(select, optionEl);
        });
        _append(root, select);
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description An accessible toggle switch (role="switch").
       * @param {boolean} [checked] - Initial checked state
       * @param {Function} [onChange] - Called with the new boolean state on toggle
       * @param {string} [label] - Optional label text shown beside the switch
       * @param {boolean} [disabled] - Disable the switch
       * @returns {HTMLElement}
       */
      switch: function (opts) {
        opts = opts || {};
        var checked = !!opts.checked;
        var track = _el(
          'button',
          _cx(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full',
            _TRANSITION,
            _FOCUS_RING,
            checked ? 'bg-sky-600' : 'bg-gray-300 dark:bg-gray-600',
            opts.disabled && 'opacity-50 cursor-not-allowed',
          ),
          {
            type: 'button',
            role: 'switch',
            'aria-checked': String(checked),
            disabled: !!opts.disabled,
          },
        );
        var thumb = _el(
          'span',
          _cx(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          ),
        );
        _append(track, thumb);
        track.addEventListener('click', function () {
          checked = !checked;
          track.setAttribute('aria-checked', String(checked));
          track.className = _cx(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full',
            _TRANSITION,
            _FOCUS_RING,
            checked ? 'bg-sky-600' : 'bg-gray-300 dark:bg-gray-600',
            opts.disabled && 'opacity-50 cursor-not-allowed',
          );
          thumb.className = _cx(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          );
          if (opts.onChange) opts.onChange(checked);
        });
        if (!opts.label) return track;
        var root = _el('label', 'inline-flex items-center gap-2');
        _append(root, [
          track,
          _el('span', 'text-sm text-gray-700 dark:text-gray-300', {
            text: opts.label,
          }),
        ]);
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A native checkbox with a label.
       * @param {boolean} [checked] - Initial checked state
       * @param {Function} [onChange] - Called with the new boolean state on change
       * @param {string} [label] - Label text shown beside the checkbox
       * @param {boolean} [disabled] - Disable the checkbox
       * @returns {HTMLElement}
       */
      checkbox: function (opts) {
        opts = opts || {};
        var id = _nextId('checkbox');
        var input = _el(
          'input',
          _cx('h-4 w-4 rounded border-gray-300 accent-sky-600', _FOCUS_RING),
          {
            id: id,
            type: 'checkbox',
            checked: !!opts.checked,
            disabled: !!opts.disabled,
            onChange: function (e) {
              if (opts.onChange) opts.onChange(e.target.checked);
            },
          },
        );
        var root = _el(
          'label',
          'inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300',
          {
            for: id,
          },
        );
        _append(root, [input, opts.label]);
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A group of mutually-exclusive radio buttons.
       * @param {string} name - Shared name attribute for the radio group
       * @param {Array} options - Array of { value, label }
       * @param {string} [value] - Initially selected value
       * @param {Function} [onChange] - Called with the new string value on change
       * @param {boolean} [disabled] - Disable every radio in the group
       * @returns {HTMLElement}
       */
      radioGroup: function (opts) {
        opts = opts || {};
        var root = _el('div', 'flex flex-col gap-2', { role: 'radiogroup' });
        (opts.options || []).forEach(function (o) {
          var id = _nextId('radio');
          var input = _el(
            'input',
            _cx('h-4 w-4 border-gray-300 accent-sky-600', _FOCUS_RING),
            {
              id: id,
              type: 'radio',
              name: opts.name,
              value: o.value,
              checked: o.value === opts.value,
              disabled: !!opts.disabled,
              onChange: function (e) {
                if (e.target.checked && opts.onChange) opts.onChange(o.value);
              },
            },
          );
          var label = _el(
            'label',
            'inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300',
            {
              for: id,
            },
          );
          _append(label, [input, o.label]);
          _append(root, label);
        });
        return root;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A form label, with an optional required-field asterisk.
       * @param {string} text - Label text
       * @param {string} [for] - id of the associated form control
       * @param {boolean} [required] - Show a red asterisk after the text
       * @returns {HTMLElement}
       */
      label: function (opts) {
        opts = opts || {};
        var el = _el(
          'label',
          'block text-sm font-medium text-gray-700 dark:text-gray-300',
          {
            for: opts['for'],
          },
        );
        _append(el, opts.text);
        if (opts.required) {
          _append(el, _el('span', 'ml-0.5 text-red-500', { text: '*' }));
        }
        return el;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description A focus-trapped panel that slides in from a screen edge; closes on Escape, backdrop click, or close button.
       * @param {string} title - Sheet title
       * @param {HTMLElement|string} children - Sheet body content
       * @param {Function} [onClose] - Called when the sheet is dismissed
       * @param {string} [side] - "right" (default) or "left"
       * @param {boolean} [open] - Whether to render the sheet already open (default true)
       * @returns {HTMLElement}
       */
      sheet: function (opts) {
        opts = opts || {};
        var side = opts.side === 'left' ? 'left' : 'right';
        var initiallyOpen = opts.open !== false;
        var titleId = _nextId('sheet-title');

        var backdrop = _el('div', 'fixed inset-0 z-50 bg-black/50');
        var panel = _el(
          'div',
          _cx(
            'fixed inset-y-0 z-50 flex w-full max-w-sm flex-col bg-white p-6 shadow-2xl transition-transform duration-200 dark:bg-gray-800',
            side === 'right' ? 'right-0' : 'left-0',
            initiallyOpen
              ? 'translate-x-0'
              : side === 'right'
                ? 'translate-x-full'
                : '-translate-x-full',
          ),
          { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        );

        var cleanupFocus;
        function close() {
          if (cleanupFocus) cleanupFocus();
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          if (panel.parentNode) panel.parentNode.removeChild(panel);
          if (opts.onClose) opts.onClose();
        }

        var header = _el('div', 'mb-4 flex items-center justify-between');
        _append(header, [
          _el('h2', 'text-lg font-semibold text-gray-900 dark:text-gray-100', {
            id: titleId,
            text: opts.title,
          }),
          _el(
            'button',
            'rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200',
            {
              type: 'button',
              'aria-label': 'Close',
              onClick: close,
              text: '×',
            },
          ),
        ]);
        var body = _el(
          'div',
          'flex-1 overflow-y-auto text-sm text-gray-600 dark:text-gray-300',
        );
        _append(body, opts.children);
        _append(panel, [header, body]);

        backdrop.addEventListener('click', close);
        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
        if (initiallyOpen) cleanupFocus = _trapFocus(panel, close);
        return panel;
      },

      /**
       * @component
       * @namespace sdk.ui
       * @description An anchored popover that opens near its trigger; closes on outside click or Escape.
       * @param {HTMLElement} trigger - The element that toggles the popover
       * @param {HTMLElement|string} content - Popover body content
       * @param {boolean} [open] - Initial open state (default false)
       * @param {Function} [onOpenChange] - Called with the new boolean open state on toggle
       * @returns {HTMLElement}
       */
      popover: function (opts) {
        opts = opts || {};
        var root = _el('div', 'relative inline-block');
        var panel = _el(
          'div',
          _cx(
            'absolute left-0 z-20 mt-1 min-w-[12rem] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800',
            opts.open ? '' : 'hidden',
          ),
        );
        _append(panel, opts.content);

        function setOpen(next) {
          panel.classList.toggle('hidden', !next);
          if (next) {
            document.addEventListener('click', onDocClick, true);
            document.addEventListener('keydown', onKeydown, true);
          } else {
            document.removeEventListener('click', onDocClick, true);
            document.removeEventListener('keydown', onKeydown, true);
          }
          if (opts.onOpenChange) opts.onOpenChange(next);
        }
        function onDocClick(e) {
          if (!root.contains(e.target)) setOpen(false);
        }
        function onKeydown(e) {
          if (e.key === 'Escape') {
            setOpen(false);
            opts.trigger.focus();
          }
        }
        opts.trigger.addEventListener('click', function () {
          setOpen(panel.classList.contains('hidden'));
        });

        _append(root, [opts.trigger, panel]);
        if (opts.open) setOpen(true);
        return root;
      },
    },

    // ── Raw request (escape hatch) ────────────────────────────────────────
    // `timeoutMs` is optional; omit for the default. Pass a larger value for
    // any custom endpoint that runs an agent / other long operation.
    request: function (method, path, body, timeoutMs) {
      return request(method, path, body, timeoutMs);
    },
  };

  global.OpenAidy = sdk;
})(typeof window !== 'undefined' ? window : globalThis);
