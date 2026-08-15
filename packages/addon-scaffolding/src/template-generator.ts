/**
 * Template Generator - Generate addon projects from templates
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TemplateOptions {
  name: string;
  id: string;
  description?: string;
  permissions?: string[];
  externalDomains?: string[];
  externalImageDomains?: string[];
  externalMediaDomains?: string[];
}

export interface TemplateResult {
  success: boolean;
  message: string;
  files: string[];
}

/**
 * Generate addon project from template
 */
export async function generateFromTemplate(
  templateName: string,
  projectPath: string,
  options: TemplateOptions,
): Promise<TemplateResult> {
  switch (templateName) {
    case 'basic':
      return generateBasicTemplate(projectPath, options);
    case 'agent':
      return generateAgentTemplate(projectPath, options);
    default:
      return {
        success: false,
        message: `Unknown template: ${templateName}. Valid templates: basic, agent`,
        files: [],
      };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function writeManifest(
  projectPath: string,
  opts: TemplateOptions,
  extra: Record<string, unknown> = {},
): void {
  const manifest: Record<string, unknown> = {
    id: opts.id,
    name: opts.name,
    version: '1.0.0',
    description: opts.description ?? `${opts.name} addon for OpenAidy`,
    openaidy: { minVersion: '0.0.0' },
    entry: 'app/index.html',
    permissions: opts.permissions ?? ['agents.list', 'agents.invoke'],
    ui: {
      sidebar: { icon: 'box', label: opts.name, order: 100 },
      routes: [{ path: `/${opts.id}`, component: 'MainPage' }],
    },
    agents: [],
    config: { schema: { type: 'object', properties: {} }, defaults: {} },
    dependencies: {},
    ...extra,
  };
  // Every addon gets the Tailwind CDN <script> above (informational here —
  // enforcement is a fixed platform script-src allowance, see routes/addons.ts).
  manifest['externalDomains'] = Array.from(
    new Set([...(opts.externalDomains ?? []), 'cdn.tailwindcss.com']),
  );
  if (opts.externalImageDomains && opts.externalImageDomains.length > 0) {
    manifest['externalImageDomains'] = opts.externalImageDomains;
  }
  if (opts.externalMediaDomains && opts.externalMediaDomains.length > 0) {
    manifest['externalMediaDomains'] = opts.externalMediaDomains;
  }
  fs.writeFileSync(
    path.join(projectPath, 'addon.json'),
    JSON.stringify(manifest, null, 2),
  );
}

function writeConfigSchema(projectPath: string): void {
  fs.writeFileSync(
    path.join(projectPath, 'config-schema.json'),
    JSON.stringify({ type: 'object', properties: {} }, null, 2),
  );
}

function writeReadme(projectPath: string, opts: TemplateOptions): void {
  fs.writeFileSync(
    path.join(projectPath, 'README.md'),
    `# ${opts.name}\n\n${opts.description ?? `${opts.name} addon for OpenAidy`}\n\n## Development\n\nEdit \`app/index.html\` and \`app/index.js\` directly — no build step needed.\n\n## Validate\n\n\`\`\`bash\nopenaidy addon validate\n\`\`\`\n`,
  );
}

// Every addon gets Tailwind CSS for free — see apps/server/src/tools/addons/create.ts
// for the matching injection on the agent-tool path (which overwrites this
// template's index.html with agent-supplied content, so both places need it).
const TAILWIND_CDN_TAG =
  '  <script src="https://cdn.tailwindcss.com"></script>';

// Shared CSS for both templates.
//
// Colors come from the host's theme via CSS custom properties on `:root`.
// `apps/web/src/index.css` defines the same names (`--bg-primary`, etc.) and
// the host passes the resolved values down via OPENAIDY_INIT. Referencing the
// variables (not hardcoded values) means the addon tracks the host's theme
// without us having to know which palette the host ships today.
const SHARED_CSS = `    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
    }
    main { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    .card {
      background: var(--bg-elevated);
      border: 1px solid var(--border-primary);
      border-radius: 12px;
      padding: 20px;
    }
    .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 12px; color: var(--text-primary); }
    .card p { font-size: 0.875rem; color: var(--text-tertiary); line-height: 1.6; }
    label {
      display: block;
      font-size: 0.813rem;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    select, textarea, input {
      width: 100%;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.875rem;
      padding: 10px 12px;
      outline: none;
      transition: border-color 0.15s;
    }
    select:focus, textarea:focus, input:focus { border-color: var(--primary); }
    textarea { resize: vertical; min-height: 80px; }
    .field { margin-bottom: 14px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 18px;
      border: none;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
      color: #fff;
      background: var(--primary);
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:hover:not(:disabled) { opacity: 0.9; }
    .response-box {
      margin-top: 14px;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 14px;
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--text-primary);
      white-space: pre-wrap;
      display: none;
    }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      color: #fff;
      margin-top: 4px;
    }
    .badge-ok { background: var(--success); }
    .badge-err { background: var(--danger); }
    .badge-wait { background: var(--primary); }`;

// Shared JS for SDK loading and agent invocation (used by both templates).
//
// `applyTheme` writes the host's CSS custom properties onto `:root` so the
// shared stylesheet (which references them) renders the host's palette on
// first paint. It is called once on init and again on every
// `OPENAIDY_THEME_CHANGED` postMessage the host sends while the addon is
// loaded, so a user who toggles light/dark in the host sees the addon follow
// without a reload. A small fallback set is hardcoded so the addon still
// paints (with the host's dark defaults) when the init message is delayed or
// the host predates this contract.
const SHARED_SDK_JS = `// Fallback tokens — used until the host's OPENAIDY_INIT arrives.
// These intentionally mirror the host's .dark palette in apps/web/src/index.css
// so an addon that paints before the init message still looks reasonable.
var FALLBACK_TOKENS = {
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
  '--border-secondary': '#4b5563'
};

function applyTheme(theme) {
  if (!theme) return;
  var tokens = theme.tokens || {};
  var root = document.documentElement;
  // Apply every token the host sent, then fall back for any it didn't.
  var keys = Object.keys(FALLBACK_TOKENS);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = tokens[k] || FALLBACK_TOKENS[k];
    root.style.setProperty(k, v);
  }
  // The .dark class is the source of truth for Tailwind dark: variants when
  // the host includes any in its addons; we mirror it so Tailwind classes
  // (e.g. text-text-primary) still resolve correctly inside the iframe.
  if (theme.mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// Signal the parent that this addon is ready to receive OPENAIDY_INIT.
// The parent may have already sent it before this script executed, so we
// also listen for OPENAIDY_THEME_CHANGED so a user who toggles the host's
// theme while the addon is open sees the addon follow without a reload.
// The listener stays registered for the addon's lifetime so a later
// OPENAIDY_THEME_CHANGED still reaches applyTheme(). Loading the SDK is the
// only part gated on the initialised flag — the theme is applied on every
// themed message, including a repeated init.
applyTheme({ mode: 'dark', tokens: FALLBACK_TOKENS });

var initialised = false;
window.addEventListener('message', function onMessage(event) {
  var msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type !== 'OPENAIDY_INIT' && msg.type !== 'OPENAIDY_THEME_CHANGED') {
    return;
  }
  // Both messages carry the host's current theme. Apply it every time: the
  // host sends OPENAIDY_INIT twice by design (on iframe load, then again on
  // ADDON_READY), and the second one may carry a newer palette than the first.
  applyTheme(msg.theme);
  if (msg.type === 'OPENAIDY_INIT' && !initialised) {
    initialised = true;
    var script = document.createElement('script');
    script.src = msg.apiBase + '/sdk/openaidy-sdk.js';
    script.onload = function() { onSdkReady(msg); };
    document.head.appendChild(script);
  }
});
window.parent.postMessage({ type: 'ADDON_READY' }, '*');`;

// ---------------------------------------------------------------------------
// Basic template — minimal hello-world addon
// ---------------------------------------------------------------------------

function generateBasicTemplate(
  projectPath: string,
  opts: TemplateOptions,
): TemplateResult {
  const files: string[] = [];
  const uiDir = path.join(projectPath, 'app');
  fs.mkdirSync(uiDir, { recursive: true });

  writeManifest(projectPath, opts);
  files.push('addon.json');

  writeConfigSchema(projectPath);
  files.push('config-schema.json');

  writeReadme(projectPath, opts);
  files.push('README.md');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.name}</title>
  <style>
${SHARED_CSS}
  </style>
${TAILWIND_CDN_TAG}
</head>
<body>
  <main>
    <div class="card">
      <h2>${opts.name}</h2>
      <p id="status-el">Connecting to OpenAidy...</p>
    </div>
  </main>
  <script src="index.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(uiDir, 'index.html'), html);
  files.push('app/index.html');

  const js = `var statusEl = document.getElementById('status-el');
var _initReceived = false;

${SHARED_SDK_JS}

// Show an error if the SDK init message never arrives (e.g. addon not enabled)
setTimeout(function() {
  if (!_initReceived) {
    statusEl.textContent = 'Not connected \u2014 make sure the addon is enabled in OpenAidy.';
    statusEl.style.color = '#f87171';
  }
}, 5000);

function onSdkReady(msg) {
  _initReceived = true;
  OpenAidy.ready(function(sdk) {
    statusEl.textContent = 'Connected \u2713';
    statusEl.style.color = '#4ade80';
    // TODO: add your addon logic here using the sdk object.
    // Example: sdk.listAgents().then(function(result) { ... });
  });
}
`;
  fs.writeFileSync(path.join(uiDir, 'index.js'), js);
  files.push('app/index.js');

  return {
    success: true,
    message: `Generated basic template for "${opts.name}"`,
    files,
  };
}

// ---------------------------------------------------------------------------
// Agent template — agent runner with select + prompt UI
// ---------------------------------------------------------------------------

function generateAgentTemplate(
  projectPath: string,
  opts: TemplateOptions,
): TemplateResult {
  const files: string[] = [];
  const uiDir = path.join(projectPath, 'app');
  fs.mkdirSync(uiDir, { recursive: true });

  writeManifest(projectPath, opts);
  files.push('addon.json');

  writeConfigSchema(projectPath);
  files.push('config-schema.json');

  writeReadme(projectPath, opts);
  files.push('README.md');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.name}</title>
  <style>
${SHARED_CSS}
  </style>
${TAILWIND_CDN_TAG}
</head>
<body>
  <main>
    <div class="card">
      <h2>Agent Runner</h2>
      <p>Select an agent, type a prompt, and send it.</p>
    </div>

    <div class="card">
      <div class="field">
        <label for="agent-select">Agent</label>
        <select id="agent-select" disabled>
          <option value="">Loading agents...</option>
        </select>
      </div>
      <div class="field">
        <label for="prompt-input">Prompt</label>
        <textarea id="prompt-input" placeholder="Ask the agent something..." disabled></textarea>
      </div>
      <button class="btn" id="send-btn" disabled>Send</button>
      <div class="response-box" id="response-box"></div>
    </div>
  </main>
  <script src="index.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(uiDir, 'index.html'), html);
  files.push('app/index.html');

  const js = `var agentSelect = document.getElementById('agent-select');
var promptInput = document.getElementById('prompt-input');
var sendBtn     = document.getElementById('send-btn');
var responseBox = document.getElementById('response-box');
var _sdk;

function setResponse(text, type) {
  responseBox.style.display = 'block';
  responseBox.innerHTML = '';
  var badge = document.createElement('span');
  badge.className = 'badge ' + (type === 'error' ? 'badge-err' : type === 'wait' ? 'badge-wait' : 'badge-ok');
  badge.textContent = type === 'error' ? 'Error' : type === 'wait' ? 'Sending...' : 'Response';
  responseBox.appendChild(badge);
  var content = document.createElement('p');
  content.style.marginTop = '10px';
  content.textContent = text;
  responseBox.appendChild(content);
}

${SHARED_SDK_JS}

function onSdkReady(msg) {
  OpenAidy.ready(function(sdk) {
    _sdk = sdk;
    sdk.listAgents().then(function(result) {
      var agents = result.items || result.agents || result || [];
      agentSelect.innerHTML = '';
      if (agents.length === 0) {
        agentSelect.innerHTML = '<option value="">No agents available</option>';
      } else {
        agents.forEach(function(agent) {
          var opt = document.createElement('option');
          opt.value = agent.id || agent.agentId || '';
          opt.textContent = agent.name || agent.id || 'Unnamed';
          agentSelect.appendChild(opt);
        });
        agentSelect.disabled = false;
        promptInput.disabled = false;
        sendBtn.disabled = false;
      }
    }).catch(function(e) {
      agentSelect.innerHTML = '<option value="">Failed to load agents</option>';
      setResponse(e.message, 'error');
    });
  });
}

sendBtn.addEventListener('click', function() {
  var agentId = agentSelect.value;
  var prompt  = promptInput.value.trim();
  if (!agentId || !prompt) return;
  sendBtn.disabled = true;
  setResponse('Waiting for agent response...', 'wait');
  _sdk.invokeAgent(agentId, prompt).then(function(result) {
    setResponse(result.message || JSON.stringify(result, null, 2), 'ok');
  }).catch(function(e) {
    setResponse(e.message, 'error');
  }).finally(function() {
    sendBtn.disabled = false;
  });
});
`;
  fs.writeFileSync(path.join(uiDir, 'index.js'), js);
  files.push('app/index.js');

  return {
    success: true,
    message: `Generated agent template for "${opts.name}"`,
    files,
  };
}

/**
 * List available templates
 */
export function listTemplates(): Array<{ name: string; description: string }> {
  return [
    {
      name: 'basic',
      description: 'Minimal addon — hello world with SDK connection',
    },
    {
      name: 'agent',
      description: 'Agent runner — select an agent and invoke it with a prompt',
    },
  ];
}
