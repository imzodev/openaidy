/**
 * Documentation Generator
 *
 * Generates documentation from addon manifests and source code.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface DocOptions {
  format?: 'markdown' | 'html' | 'json';
  includeExamples?: boolean;
  includeApi?: boolean;
  outputDir?: string;
}

export interface DocResult {
  success: boolean;
  message: string;
  outputPath?: string;
}

/**
 * Generate documentation for an addon
 */
export async function generateDocs(
  projectPath: string,
  options: DocOptions = {},
): Promise<DocResult> {
  const { includeApi = true, outputDir } = options;

  // Validate project
  if (!fs.existsSync(projectPath)) {
    return {
      success: false,
      message: `Project directory not found: ${projectPath}`,
    };
  }

  const manifestPath = path.join(projectPath, 'addon.json');
  if (!fs.existsSync(manifestPath)) {
    return { success: false, message: 'addon.json not found' };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const output = outputDir || path.join(projectPath, 'docs');

    if (!fs.existsSync(output)) {
      fs.mkdirSync(output, { recursive: true });
    }

    // Generate README
    const readmeContent = generateReadme(manifest);
    fs.writeFileSync(path.join(output, 'README.md'), readmeContent);

    // Generate API docs if requested
    if (includeApi) {
      const apiContent = generateApiDocs(manifest);
      fs.writeFileSync(path.join(output, 'API.md'), apiContent);
    }

    // Generate configuration guide
    const configContent = generateConfigGuide(manifest);
    fs.writeFileSync(path.join(output, 'CONFIGURATION.md'), configContent);

    return {
      success: true,
      message: `Documentation generated in ${output}`,
      outputPath: output,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to generate documentation: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Generate README documentation
 */
function generateReadme(manifest: Record<string, unknown>): string {
  const id = String(manifest.id || 'addon');
  const name = String(manifest.name || id);
  const description = String(manifest.description || 'An OpenAidy addon');
  const version = String(manifest.version || '1.0.0');
  const author = (manifest.author as Record<string, string>) || {};

  let content = `# ${name}\n\n`;
  content += `${description}\n\n`;
  content += `**Version:** ${version}\n\n`;

  if (author.name || author.email) {
    content += `**Author:** ${author.name || ''}${author.email ? ` <${author.email}>` : ''}\n\n`;
  }

  content += `## Installation\n\n`;
  content += `\`\`\`bash\nnpm install @openaidy/addon-${id}\n\`\`\`\n\n`;

  content += `## Usage\n\n`;
  content += `\`\`\`javascript\nimport { ${name.replace(/\s+/g, '')} } from '@openaidy/addon-${id}';\n\nconst addon = new ${name.replace(/\s+/g, '')}(config);\naddon.start();\n\`\`\`\n\n`;

  // Add routes if defined
  const ui = manifest.ui as Record<string, unknown> | undefined;
  if (ui && (ui as Record<string, unknown>).routes) {
    content += `## Routes\n\n`;
    const routes = (ui as Record<string, unknown>).routes as Array<{
      path: string;
      component: string;
    }>;
    for (const route of routes) {
      content += `- \`${route.path}\` - ${route.component}\n`;
    }
    content += `\n`;
  }

  // Add agents if defined
  const agents = manifest.agents as Array<Record<string, unknown>> | undefined;
  if (agents && agents.length > 0) {
    content += `## Agents\n\n`;
    for (const agent of agents) {
      content += `### ${agent.id}\n\n`;
      content += `${agent.description || 'Agent description not available'}\n\n`;
    }
  }

  content += `## Configuration\n\n`;
  content += `See [CONFIGURATION.md](./CONFIGURATION.md) for detailed configuration options.\n\n`;

  content += `## License\n\n`;
  content += `${manifest.license || 'MIT'}\n`;

  return content;
}

/**
 * Generate API documentation
 */
function generateApiDocs(manifest: Record<string, unknown>): string {
  let content = `# API Documentation\n\n`;
  content += `## ${manifest.name}\n\n`;
  content += `Version: ${manifest.version}\n\n`;

  content += `## Runtime API\n\n`;
  content += `The addon implements the following runtime interface:\n\n`;

  content += `### Methods\n\n`;
  content += `- \`start()\` - Initialize and start the addon\n`;
  content += `- \`stop()\` - Gracefully stop the addon\n`;
  content += `- \`invoke(input)\` - Invoke addon with input data\n`;
  content += `- \`getState()\` - Get current addon state\n`;
  content += `- \`setState(state)\` - Update addon state\n\n`;

  content += `### Events\n\n`;
  content += `- \`ready\` - Emitted when addon is fully initialized\n`;
  content += `- \`error\` - Emitted when an error occurs\n`;
  content += `- \`message\` - Emitted when a message is received\n\n`;

  content += `## Permissions\n\n`;
  const permissions = (manifest.permissions as string[]) || [];
  if (permissions.length === 0) {
    content += `No specific permissions required.\n`;
  } else {
    content += `This addon requires the following permissions:\n\n`;
    for (const permission of permissions) {
      content += `- \`${permission}\`\n`;
    }
    content += `\n`;
  }

  return content;
}

/**
 * Generate configuration guide
 */
function generateConfigGuide(manifest: Record<string, unknown>): string {
  let content = `# Configuration Guide\n\n`;

  const config = manifest.config as Record<string, unknown> | undefined;
  if (!config || !config.schema) {
    content += `This addon has no configurable options.\n`;
    return content;
  }

  content += `## Configuration Schema\n\n`;
  content += `\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n\n`;

  content += `## Default Values\n\n`;
  const defaults = (config.defaults as Record<string, unknown>) || {};
  if (Object.keys(defaults).length === 0) {
    content += `No default values configured.\n`;
  } else {
    content += `| Setting | Default Value |\n`;
    content += `|---------|---------------|\n`;
    for (const [key, value] of Object.entries(defaults)) {
      content += `| ${key} | \`${JSON.stringify(value)}\` |\n`;
    }
    content += `\n`;
  }

  return content;
}

/**
 * Validate documentation completeness
 */
export function validateDocs(projectPath: string): {
  valid: boolean;
  missing: string[];
  suggestions: string[];
} {
  const missing: string[] = [];
  const suggestions: string[] = [];

  const docsPath = path.join(projectPath, 'docs');
  if (!fs.existsSync(docsPath)) {
    missing.push('docs/');
    return { valid: false, missing, suggestions };
  }

  const requiredFiles = ['README.md', 'API.md', 'CONFIGURATION.md'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(docsPath, file))) {
      missing.push(`docs/${file}`);
      suggestions.push(
        `Missing ${file} - run 'openaidy docs generate' to create`,
      );
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    suggestions,
  };
}
