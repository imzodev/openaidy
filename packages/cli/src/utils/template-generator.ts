/**
 * Template Generator - Generate addon projects from templates
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TemplateOptions {
  name: string;
  description?: string;
  author?: string;
  email?: string;
  typescript?: boolean;
}

export interface TemplateResult {
  success: boolean;
  message: string;
  files: string[];
}

/**
 * Template variables for substitution
 */
interface TemplateVariables {
  name: string;
  id: string;
  description: string;
  author: string;
  email: string;
  version: string;
  typescript: boolean;
  year: number;
}

/**
 * Generate addon project from template
 */
export async function generateFromTemplate(
  templateName: string,
  projectPath: string,
  options: TemplateOptions,
): Promise<TemplateResult> {
  const {
    name,
    description = '',
    author = '',
    email = '',
    typescript = true,
  } = options;

  // Create project ID from name
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const variables: TemplateVariables = {
    name,
    id,
    description,
    author,
    email,
    version: '1.0.0',
    typescript,
    year: new Date().getFullYear(),
  };

  // Generate based on template type
  switch (templateName) {
    case 'basic':
      return generateBasicTemplate(projectPath, variables);
    case 'agent':
      return generateAgentTemplate(projectPath, variables);
    case 'multi-page':
      return generateMultiPageTemplate(projectPath, variables);
    case 'config':
      return generateConfigTemplate(projectPath, variables);
    default:
      return {
        success: false,
        message: `Unknown template: ${templateName}`,
        files: [],
      };
  }
}

/**
 * Generate basic template
 */
async function generateBasicTemplate(
  projectPath: string,
  vars: TemplateVariables,
): Promise<TemplateResult> {
  const files: string[] = [];

  // Create directory structure
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'public'), { recursive: true });

  // Generate addon.json
  const manifest = generateManifest(vars);
  fs.writeFileSync(path.join(projectPath, 'addon.json'), manifest);
  files.push('addon.json');

  // Generate src/index.ts
  const mainContent = generateBasicMain(vars);
  fs.writeFileSync(path.join(projectPath, 'src', 'index.ts'), mainContent);
  files.push('src/index.ts');

  // Generate package.json
  const pkgJson = generatePackageJson(vars);
  fs.writeFileSync(path.join(projectPath, 'package.json'), pkgJson);
  files.push('package.json');

  // Generate tsconfig.json
  if (vars.typescript) {
    const tsconfig = generateTsconfig();
    fs.writeFileSync(path.join(projectPath, 'tsconfig.json'), tsconfig);
    files.push('tsconfig.json');
  }

  return {
    success: true,
    message: `Generated basic template for "${vars.name}"`,
    files,
  };
}

/**
 * Generate agent integration template
 */
async function generateAgentTemplate(
  projectPath: string,
  vars: TemplateVariables,
): Promise<TemplateResult> {
  const files: string[] = [];

  // Create directory structure
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'src', 'agents'), { recursive: true });

  // Generate addon.json with agent config
  const manifest = generateAgentManifest(vars);
  fs.writeFileSync(path.join(projectPath, 'addon.json'), manifest);
  files.push('addon.json');

  // Generate src/index.ts with agent integration
  const mainContent = generateAgentMain(vars);
  fs.writeFileSync(path.join(projectPath, 'src', 'index.ts'), mainContent);
  files.push('src/index.ts');

  // Generate agent implementation
  const agentContent = generateAgentImpl(vars);
  fs.writeFileSync(
    path.join(projectPath, 'src', 'agents', 'main-agent.ts'),
    agentContent,
  );
  files.push('src/agents/main-agent.ts');

  // Generate package.json
  fs.writeFileSync(
    path.join(projectPath, 'package.json'),
    generatePackageJson(vars),
  );
  files.push('package.json');

  if (vars.typescript) {
    fs.writeFileSync(
      path.join(projectPath, 'tsconfig.json'),
      generateTsconfig(),
    );
    files.push('tsconfig.json');
  }

  return {
    success: true,
    message: `Generated agent template for "${vars.name}"`,
    files,
  };
}

/**
 * Generate multi-page template
 */
async function generateMultiPageTemplate(
  projectPath: string,
  vars: TemplateVariables,
): Promise<TemplateResult> {
  const files: string[] = [];

  // Create directory structure
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'src', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'src', 'components'), {
    recursive: true,
  });

  // Generate addon.json with multiple routes
  const manifest = generateMultiPageManifest(vars);
  fs.writeFileSync(path.join(projectPath, 'addon.json'), manifest);
  files.push('addon.json');

  // Generate src/index.ts
  fs.writeFileSync(
    path.join(projectPath, 'src', 'index.ts'),
    generateMultiPageMain(vars),
  );
  files.push('src/index.ts');

  // Generate pages
  fs.writeFileSync(
    path.join(projectPath, 'src', 'pages', 'MainPage.tsx'),
    generatePage('Main'),
  );
  files.push('src/pages/MainPage.tsx');

  fs.writeFileSync(
    path.join(projectPath, 'src', 'pages', 'SettingsPage.tsx'),
    generatePage('Settings'),
  );
  files.push('src/pages/SettingsPage.tsx');

  // Generate package.json
  fs.writeFileSync(
    path.join(projectPath, 'package.json'),
    generatePackageJson(vars),
  );
  files.push('package.json');

  if (vars.typescript) {
    fs.writeFileSync(
      path.join(projectPath, 'tsconfig.json'),
      generateTsconfig(),
    );
    files.push('tsconfig.json');
  }

  return {
    success: true,
    message: `Generated multi-page template for "${vars.name}"`,
    files,
  };
}

/**
 * Generate configuration-focused template
 */
async function generateConfigTemplate(
  projectPath: string,
  vars: TemplateVariables,
): Promise<TemplateResult> {
  const files: string[] = [];

  // Create directory structure
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });

  // Generate addon.json with config schema
  const manifest = generateConfigManifest(vars);
  fs.writeFileSync(path.join(projectPath, 'addon.json'), manifest);
  files.push('addon.json');

  // Generate config schema
  const configSchema = generateConfigSchema();
  fs.writeFileSync(
    path.join(projectPath, 'config-schema.json'),
    JSON.stringify(configSchema, null, 2),
  );
  files.push('config-schema.json');

  // Generate src/index.ts
  fs.writeFileSync(
    path.join(projectPath, 'src', 'index.ts'),
    generateConfigMain(vars),
  );
  files.push('src/index.ts');

  // Generate package.json
  fs.writeFileSync(
    path.join(projectPath, 'package.json'),
    generatePackageJson(vars),
  );
  files.push('package.json');

  if (vars.typescript) {
    fs.writeFileSync(
      path.join(projectPath, 'tsconfig.json'),
      generateTsconfig(),
    );
    files.push('tsconfig.json');
  }

  return {
    success: true,
    message: `Generated config template for "${vars.name}"`,
    files,
  };
}

// Helper functions for generating content

function generateManifest(vars: TemplateVariables): string {
  return JSON.stringify(
    {
      id: vars.id,
      name: vars.name,
      version: vars.version,
      description: vars.description || `${vars.name} addon for OpenAidy`,
      author: {
        name: vars.author,
        email: vars.email,
      },
      openaidy: {
        minVersion: '1.0.0',
        maxVersion: '2.0.0',
      },
      entry: 'dist/index.js',
      permissions: [],
      ui: {
        sidebar: {
          icon: 'box',
          label: vars.name,
          order: 100,
        },
        routes: [
          {
            path: `/${vars.id}`,
            component: 'MainPage',
          },
        ],
      },
      agents: [],
      config: {
        schema: './config-schema.json',
        defaults: {},
      },
    },
    null,
    2,
  );
}

function generateAgentManifest(vars: TemplateVariables): string {
  const manifest = JSON.parse(generateManifest(vars));
  manifest.agents = [
    {
      id: vars.id,
      required: true,
      description: `${vars.name} main agent`,
    },
  ];
  manifest.ui.routes = [
    { path: `/${vars.id}`, component: 'MainPage' },
    { path: `/${vars.id}/settings`, component: 'SettingsPage' },
  ];
  return JSON.stringify(manifest, null, 2);
}

function generateMultiPageManifest(vars: TemplateVariables): string {
  const manifest = JSON.parse(generateManifest(vars));
  manifest.ui.routes = [
    { path: `/${vars.id}`, component: 'MainPage' },
    { path: `/${vars.id}/settings`, component: 'SettingsPage' },
    { path: `/${vars.id}/about`, component: 'AboutPage' },
  ];
  return JSON.stringify(manifest, null, 2);
}

function generateConfigManifest(vars: TemplateVariables): string {
  const manifest = JSON.parse(generateManifest(vars));
  manifest.config = {
    schema: './config-schema.json',
    defaults: {
      setting1: 'value1',
      setting2: true,
    },
  };
  return JSON.stringify(manifest, null, 2);
}

function generateBasicMain(vars: TemplateVariables): string {
  return `/**
 * ${vars.name} Addon
 * Generated by OpenAidy CLI
 */

export default {
  id: '${vars.id}',
  name: '${vars.name}',
  version: '${vars.version}',

  async render() {
    return {
      component: {
        name: 'MainPage',
        props: {},
      },
    };
  },
};
`;
}

function generateAgentMain(vars: TemplateVariables): string {
  return `/**
 * ${vars.name} Addon - Agent Integration
 * Generated by OpenAidy CLI
 */

import { MainAgent } from './agents/main-agent.js';

export default {
  id: '${vars.id}',
  name: '${vars.name}',
  version: '${vars.version}',
  agent: MainAgent,

  async render() {
    return {
      component: {
        name: 'MainPage',
        props: {},
      },
    };
  },
};
`;
}

function generateMultiPageMain(vars: TemplateVariables): string {
  return `/**
 * ${vars.name} Addon - Multi-Page
 * Generated by OpenAidy CLI
 */

export default {
  id: '${vars.id}',
  name: '${vars.name}',
  version: '${vars.version}',
  pages: ['MainPage', 'SettingsPage', 'AboutPage'],

  async render(page?: string) {
    const componentName = page || 'MainPage';
    return {
      component: {
        name: componentName,
        props: {},
      },
    };
  },
};
`;
}

function generateConfigMain(vars: TemplateVariables): string {
  return `/**
 * ${vars.name} Addon - Configuration
 * Generated by OpenAidy CLI
 */

export default {
  id: '${vars.id}',
  name: '${vars.name}',
  version: '${vars.version}',

  async render(config) {
    return {
      component: {
        name: 'ConfigPage',
        props: { config },
      },
    };
  },

  async validateConfig(config) {
    // Configuration validation logic
    return { valid: true };
  },
};
`;
}

function generateAgentImpl(vars: TemplateVariables): string {
  return `/**
 * Main Agent Implementation
 * Agent for ${vars.name} addon
 */

export class MainAgent {
  id = '${vars.id}';
  
  async invoke(input: any): Promise<any> {
    // Agent invocation logic
    return { result: 'processed' };
  }

  async initialize(): Promise<void> {
    // Agent initialization
  }

  async cleanup(): Promise<void> {
    // Agent cleanup
  }
}

export const MainAgentInstance = new MainAgent();
`;
}

function generatePage(name: string): string {
  return `/**
 * ${name} Page Component
 */

export function ${name}Page(props: any) {
  return {
    render() {
      return (
        <div class="${name.toLowerCase()}">
          <h1>${name}</h1>
          <p>Welcome to the ${name} page</p>
        </div>
      );
    }
  };
}
`;
}

function generateConfigSchema(): string {
  return JSON.stringify(
    {
      type: 'object',
      properties: {
        setting1: {
          type: 'string',
          description: 'First setting',
          default: 'value1',
        },
        setting2: {
          type: 'boolean',
          description: 'Second setting',
          default: true,
        },
        setting3: {
          type: 'number',
          description: 'Third setting',
          default: 42,
        },
      },
      required: [],
    },
    null,
    2,
  );
}

function generatePackageJson(vars: TemplateVariables): string {
  return JSON.stringify(
    {
      name: `@openaidy/addon-${vars.id}`,
      version: vars.version,
      description: vars.description || `${vars.name} addon for OpenAidy`,
      main: 'dist/index.js',
      scripts: {
        build: 'openaidy build',
        dev: 'openaidy dev',
        test: 'openaidy test',
        validate: 'openaidy validate',
      },
      dependencies: {
        '@openaidy/sdk': 'workspace:*',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
    },
    null,
    2,
  );
}

function generateTsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: 'dist',
        rootDir: 'src',
        jsx: 'preserve',
        jsxImportSource: 'solid-js',
      },
      include: ['src/**/*'],
    },
    null,
    2,
  );
}

/**
 * List available templates
 */
export function listTemplates(): Array<{ name: string; description: string }> {
  return [
    {
      name: 'basic',
      description: 'Simple single-page addon with basic functionality',
    },
    {
      name: 'agent',
      description: 'Addon with AI agent integration and communication',
    },
    {
      name: 'multi-page',
      description: 'Multi-page addon with navigation and routing',
    },
    {
      name: 'config',
      description: 'Configuration-focused addon with settings management',
    },
  ];
}
