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
  if (opts.externalDomains && opts.externalDomains.length > 0) {
    manifest['externalDomains'] = opts.externalDomains;
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

// Shared CSS for both templates
const SHARED_CSS = `    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    main { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
    }
    .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 12px; color: #f1f5f9; }
    .card p { font-size: 0.875rem; color: #94a3b8; line-height: 1.6; }
    label {
      display: block;
      font-size: 0.813rem;
      font-weight: 500;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    select, textarea, input {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #e2e8f0;
      font-family: inherit;
      font-size: 0.875rem;
      padding: 10px 12px;
      outline: none;
      transition: border-color 0.15s;
    }
    select:focus, textarea:focus, input:focus { border-color: #0ea5e9; }
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
      background: #0ea5e9;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:hover:not(:disabled) { opacity: 0.9; }
    .response-box {
      margin-top: 14px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 14px;
      font-size: 0.875rem;
      line-height: 1.6;
      color: #e2e8f0;
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
    .badge-ok { background: #22c55e; }
    .badge-err { background: #ef4444; }
    .badge-wait { background: #0ea5e9; }`;

// Shared JS for SDK loading and agent invocation (used by both templates)
const SHARED_SDK_JS = `// Signal the parent that this addon is ready to receive OPENAIDY_INIT.
// The parent may have already sent it before this script executed.
window.addEventListener('message', function onInit(event) {
  var msg = event.data;
  if (!msg || msg.type !== 'OPENAIDY_INIT') return;
  window.removeEventListener('message', onInit);
  var script = document.createElement('script');
  script.src = msg.apiBase + '/sdk/openaidy-sdk.js';
  script.onload = function() {
    onSdkReady(msg);
  };
  document.head.appendChild(script);
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
