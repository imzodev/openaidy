/**
 * Create Command - Initialize a new addon project
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateAddonName,
  validateAddonId,
  validateTemplateName,
} from '../../utils/validation.js';
import { slugify, resolveAddonsDir } from '../../utils/project.js';
import { installAddon } from './install.js';
import type {
  CommandResult,
  CreateOptions,
  CreateResult,
} from '../../types.js';

/**
 * Create a new addon project
 */
export async function createAddon(
  name: string,
  options: CreateOptions = {},
): Promise<CreateResult> {
  const {
    directory = resolveAddonsDir(),
    template = 'basic',
    noGit = false,
    noInstall: _noInstall = false,
  } = options;

  // Validate addon name
  if (!validateAddonName(name)) {
    return {
      success: false,
      message:
        'Invalid addon name. Use letters, numbers, spaces, and hyphens only.',
    };
  }

  const addonId = slugify(name);

  // Validate addon ID
  if (!validateAddonId(addonId)) {
    return {
      success: false,
      message: 'Generated addon ID is invalid. Please choose a different name.',
    };
  }

  // Validate template
  if (!validateTemplateName(template)) {
    return {
      success: false,
      message: `Invalid template: ${template}. Valid templates are: basic, agent, multi-page, config`,
    };
  }

  const projectPath = path.join(directory, addonId);

  // Check if directory already exists
  if (fs.existsSync(projectPath)) {
    return {
      success: false,
      message: `Directory already exists: ${projectPath}`,
    };
  }

  try {
    // Create project directory
    fs.mkdirSync(projectPath, { recursive: true });

    // Create basic addon structure
    await createBasicStructure(projectPath, addonId, name, template);

    // Initialize git if requested
    if (!noGit) {
      await initGit(projectPath);
    }

    // Auto-register with the running server so it appears in the UI immediately.
    // Failure here is non-fatal — the files are already created.
    await installAddon(projectPath, {
      serverUrl: options.serverUrl,
      token: options.token,
    });

    return {
      success: true,
      message: `Successfully created addon: ${name}`,
      projectPath,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create addon: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Create basic addon file structure
 */
async function createBasicStructure(
  projectPath: string,
  addonId: string,
  name: string,
  _template: string,
): Promise<void> {
  // Create addon.json manifest
  const manifest = {
    id: addonId,
    name,
    version: '1.0.0',
    description: `${name} addon for OpenAidy`,
    openaidy: {
      minVersion: '0.0.0',
    },
    entry: 'app/index.html',
    permissions: ['agents.list', 'agents.invoke'],
    ui: {
      sidebar: {
        icon: 'box',
        label: name,
        order: 100,
      },
      routes: [
        {
          path: `/${addonId}`,
          component: 'MainPage',
        },
      ],
    },
    agents: [],
    config: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    dependencies: {},
  };

  fs.writeFileSync(
    path.join(projectPath, 'addon.json'),
    JSON.stringify(manifest, null, 2),
  );

  // Create the UI subfolder
  const uiDir = path.join(projectPath, 'app');
  fs.mkdirSync(uiDir, { recursive: true });

  // Build the HTML template in parts to avoid any escaped closing-tag fragility.
  // The SDK URL is not hardcoded — it is loaded dynamically from the apiBase
  // delivered by the parent frame in the OPENAIDY_INIT message.
  const indexHtmlHead = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <title>${name}</title>`,
    '  <style>',
    '    * { box-sizing: border-box; margin: 0; padding: 0; }',
    '    body {',
    "      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
    '      background: #0f172a;',
    '      color: #e2e8f0;',
    '      min-height: 100vh;',
    '    }',
    '    main { padding: 24px; display: flex; flex-direction: column; gap: 16px; }',
    '    .card {',
    '      background: #1e293b;',
    '      border: 1px solid #334155;',
    '      border-radius: 12px;',
    '      padding: 20px;',
    '    }',
    '    .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 12px; color: #f1f5f9; }',
    '    .card p { font-size: 0.875rem; color: #94a3b8; line-height: 1.6; }',
    '    label {',
    '      display: block;',
    '      font-size: 0.813rem;',
    '      font-weight: 500;',
    '      color: #94a3b8;',
    '      margin-bottom: 6px;',
    '    }',
    '    select, textarea {',
    '      width: 100%;',
    '      background: #0f172a;',
    '      border: 1px solid #334155;',
    '      border-radius: 8px;',
    '      color: #e2e8f0;',
    '      font-family: inherit;',
    '      font-size: 0.875rem;',
    '      padding: 10px 12px;',
    '      outline: none;',
    '      transition: border-color 0.15s;',
    '    }',
    '    select:focus, textarea:focus { border-color: #0ea5e9; }',
    '    textarea { resize: vertical; min-height: 80px; }',
    '    .field { margin-bottom: 14px; }',
    '    .btn {',
    '      display: inline-flex;',
    '      align-items: center;',
    '      gap: 6px;',
    '      padding: 9px 18px;',
    '      border: none;',
    '      border-radius: 8px;',
    '      font-size: 0.875rem;',
    '      font-weight: 500;',
    '      cursor: pointer;',
    '      transition: opacity 0.15s;',
    '      color: #fff;',
    '      background: #0ea5e9;',
    '    }',
    '    .btn:disabled { opacity: 0.5; cursor: not-allowed; }',
    '    .btn:hover:not(:disabled) { opacity: 0.9; }',
    '    .response-box {',
    '      margin-top: 14px;',
    '      background: #0f172a;',
    '      border: 1px solid #334155;',
    '      border-radius: 8px;',
    '      padding: 14px;',
    '      font-size: 0.875rem;',
    '      line-height: 1.6;',
    '      color: #e2e8f0;',
    '      white-space: pre-wrap;',
    '      display: none;',
    '    }',
    '    .badge {',
    '      display: inline-block;',
    '      padding: 2px 10px;',
    '      border-radius: 20px;',
    '      font-size: 0.75rem;',
    '      font-weight: 500;',
    '      color: #fff;',
    '      margin-top: 4px;',
    '    }',
    '    .badge-ok { background: #22c55e; }',
    '    .badge-err { background: #ef4444; }',
    '    .badge-wait { background: #0ea5e9; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <div class="card">',
    '      <h2>Agent Runner</h2>',
    "      <p>Select an agent, type a prompt, and send it. This demonstrates how addons communicate with OpenAidy's agent system.</p>",
    '    </div>',
    '',
    '    <div class="card">',
    '      <div class="field">',
    '        <label for="agent-select">Agent</label>',
    '        <select id="agent-select" disabled>',
    '          <option value="">Loading agents...</option>',
    '        </select>',
    '      </div>',
    '      <div class="field">',
    '        <label for="prompt-input">Prompt</label>',
    '        <textarea id="prompt-input" placeholder="Ask the agent something..." disabled></textarea>',
    '      </div>',
    '      <button class="btn" id="send-btn" disabled>Send</button>',
    '      <div class="response-box" id="response-box"></div>',
    '    </div>',
    '  </main>',
  ].join('\n');

  const indexHtml = [
    indexHtmlHead,
    '  <script src="index.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(uiDir, 'index.html'), indexHtml);

  // index.js — main addon logic, SDK integration, and event handlers.
  // Add companion files (utils.js, api.js, etc.) alongside this as needed.
  const indexJs = [
    "var agentSelect = document.getElementById('agent-select');",
    "var promptInput = document.getElementById('prompt-input');",
    "var sendBtn     = document.getElementById('send-btn');",
    "var responseBox = document.getElementById('response-box');",
    'var _sdk;',
    '',
    'function setResponse(text, type) {',
    "  responseBox.style.display = 'block';",
    "  responseBox.innerHTML = '';",
    "  var badge = document.createElement('span');",
    "  badge.className = 'badge ' + (type === 'error' ? 'badge-err' : type === 'wait' ? 'badge-wait' : 'badge-ok');",
    "  badge.textContent = type === 'error' ? 'Error' : type === 'wait' ? 'Sending...' : 'Response';",
    '  responseBox.appendChild(badge);',
    "  var content = document.createElement('p');",
    "  content.style.marginTop = '10px';",
    '  content.textContent = text;',
    '  responseBox.appendChild(content);',
    '}',
    '',
    '// Load the SDK dynamically once the parent sends OPENAIDY_INIT with apiBase.',
    '// This avoids hardcoding the server host/port in the addon.',
    "window.addEventListener('message', function onInit(event) {",
    '  var msg = event.data;',
    "  if (!msg || msg.type !== 'OPENAIDY_INIT') return;",
    "  window.removeEventListener('message', onInit);",
    "  var script = document.createElement('script');",
    "  script.src = msg.apiBase + '/sdk/openaidy-sdk.js';",
    '  script.onload = function() {',
    "    window.dispatchEvent(new MessageEvent('message', { data: msg }));",
    '    OpenAidy.ready(function(sdk) {',
    '      _sdk = sdk;',
    '      sdk.listAgents().then(function(result) {',
    '        var agents = result.items || result.agents || result || [];',
    "        agentSelect.innerHTML = '';",
    '        if (agents.length === 0) {',
    '          agentSelect.innerHTML = \'<option value="">No agents available</option>\';',
    '        } else {',
    '          agents.forEach(function(agent) {',
    "            var opt = document.createElement('option');",
    "            opt.value = agent.id || agent.agentId || '';",
    "            opt.textContent = agent.name || agent.id || 'Unnamed';",
    '            agentSelect.appendChild(opt);',
    '          });',
    '          agentSelect.disabled = false;',
    '          promptInput.disabled = false;',
    '          sendBtn.disabled = false;',
    '        }',
    '      }).catch(function(e) {',
    '        agentSelect.innerHTML = \'<option value="">Failed to load agents</option>\';',
    "        setResponse(e.message, 'error');",
    '      });',
    '    });',
    '  };',
    '  document.head.appendChild(script);',
    '});',
    '',
    "sendBtn.addEventListener('click', function() {",
    '  var agentId = agentSelect.value;',
    '  var prompt  = promptInput.value.trim();',
    '  if (!agentId || !prompt) return;',
    '  sendBtn.disabled = true;',
    "  setResponse('Waiting for agent response...', 'wait');",
    '  _sdk.invokeAgent(agentId, prompt).then(function(result) {',
    "    setResponse(result.message || JSON.stringify(result, null, 2), 'ok');",
    '  }).catch(function(e) {',
    "    setResponse(e.message, 'error');",
    '  }).finally(function() {',
    '    sendBtn.disabled = false;',
    '  });',
    '});',
  ].join('\n');

  fs.writeFileSync(path.join(uiDir, 'index.js'), indexJs);

  // Create config-schema.json
  const configSchema = {
    type: 'object',
    properties: {},
  };

  fs.writeFileSync(
    path.join(projectPath, 'config-schema.json'),
    JSON.stringify(configSchema, null, 2),
  );

  // Create README.md
  const readme = `# ${name}

${manifest.description}

## Development

Edit \`index.html\` directly — no build step needed.

## Validate

\`\`\`bash
openaidy addon validate
\`\`\`
`;

  fs.writeFileSync(path.join(projectPath, 'README.md'), readme);
}

/**
 * Initialize git repository
 */
async function initGit(projectPath: string): Promise<void> {
  try {
    const { execSync } = await import('node:child_process');
    execSync('git init', { cwd: projectPath, stdio: 'ignore' });
  } catch {
    // Git initialization failed, ignore
  }
}

export async function addonCreateHandler(
  args: string[],
): Promise<CommandResult> {
  const name = args[0];
  if (!name || name.startsWith('-')) {
    p.log.error('Addon name is required\nUsage: openaidy addon create <name>');
    return { exitCode: 1, error: 'Addon name is required' };
  }

  const options: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-d' || args[i] === '--directory')
      options.directory = args[++i]!;
    else if (args[i] === '-t' || args[i] === '--template')
      options.template = args[++i]!;
    else if (args[i] === '--no-git') options.noGit = true;
    else if (args[i] === '--no-install') options.noInstall = true;
  }

  p.intro(`Create Addon: ${name}`);
  const s = p.spinner();
  s.start('Scaffolding and registering addon…');
  const result = await createAddon(name, options);
  if (result.success) {
    s.stop('Addon created.');
    p.outro(
      [
        `"${name}" is ready!`,
        `  Open the app and click "${name}" in the sidebar.`,
        `  Edit your UI at: ${result.projectPath}/app/index.html`,
      ].join('\n'),
    );
    return { exitCode: 0 };
  } else {
    s.stop('Creation failed.');
    p.log.error(result.message);
    return { exitCode: 1, error: result.message };
  }
}
