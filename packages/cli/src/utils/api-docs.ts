/**
 * API Documentation Generator
 *
 * Generates API reference documentation from addon source code and types.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ApiDocOptions {
  includePrivate?: boolean;
  includeDeprecated?: boolean;
  outputFormat?: 'markdown' | 'html' | 'json';
}

export interface ApiDocResult {
  success: boolean;
  content: string;
  methods: MethodDoc[];
  events: EventDoc[];
}

export interface MethodDoc {
  name: string;
  description: string;
  parameters: ParameterDoc[];
  returns: ReturnDoc;
  examples: string[];
}

export interface ParameterDoc {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface ReturnDoc {
  type: string;
  description: string;
}

export interface EventDoc {
  name: string;
  description: string;
  payload?: string;
}

/**
 * Generate API documentation from source
 */
export async function generateApiDocsFromSource(
  projectPath: string,
  options: ApiDocOptions = {},
): Promise<ApiDocResult> {
  const { includePrivate = false, includeDeprecated = false } = options;

  const methods: MethodDoc[] = [];
  const events: EventDoc[] = [];

  // Find all TypeScript files in src
  const srcPath = path.join(projectPath, 'src');
  if (fs.existsSync(srcPath)) {
    const files = getTsFiles(srcPath);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      extractApiDocs(content, methods, events, {
        includePrivate,
        includeDeprecated,
      });
    }
  }

  const content = formatApiDocs(methods, events);

  return {
    success: true,
    content,
    methods,
    events,
  };
}

/**
 * Get all TypeScript files in directory
 */
function getTsFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getTsFiles(fullPath, files);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extract API documentation from source code
 */
function extractApiDocs(
  content: string,
  methods: MethodDoc[],
  events: EventDoc[],
  options: { includePrivate: boolean; includeDeprecated: boolean },
): void {
  // Simple extraction - in real impl would use TypeScript compiler
  const methodPattern = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g;
  let match;

  while ((match = methodPattern.exec(content)) !== null) {
    const name = match[1];
    if (!options.includePrivate && name.startsWith('_')) continue;
    if (!options.includeDeprecated && content.includes(`@deprecated`)) continue;

    // Check if already added
    if (methods.some((m) => m.name === name)) continue;

    methods.push({
      name,
      description: `Description for ${name}`,
      parameters: [],
      returns: { type: 'void', description: '' },
      examples: [],
    });
  }

  // Extract events (simple pattern)
  const eventPattern = /(?:on|emit)\s*\(\s*['"](\w+)['"]/g;
  while ((match = eventPattern.exec(content)) !== null) {
    const eventName = match[1];
    if (!events.some((e) => e.name === eventName)) {
      events.push({
        name: eventName,
        description: `Event fired when ${eventName} occurs`,
      });
    }
  }
}

/**
 * Format API documentation as markdown
 */
function formatApiDocs(methods: MethodDoc[], events: EventDoc[]): string {
  let content = '# API Reference\n\n';

  if (methods.length > 0) {
    content += '## Methods\n\n';
    for (const method of methods) {
      content += `### \`${method.name}()\`\n\n`;
      content += `${method.description}\n\n`;
      content += `**Parameters:**\n`;
      if (method.parameters.length === 0) {
        content += `- None\n`;
      } else {
        for (const param of method.parameters) {
          content += `- \`${param.name}\` (${param.type}) - ${param.description}\n`;
        }
      }
      content += `\n**Returns:** ${method.returns.type}\n\n`;
    }
  }

  if (events.length > 0) {
    content += '## Events\n\n';
    for (const event of events) {
      content += `### \`${event.name}\`\n\n`;
      content += `${event.description}\n\n`;
    }
  }

  return content;
}

/**
 * Generate example usage documentation
 */
export function generateExamples(addonId: string): string {
  return `## Usage Examples

### Basic Usage

\`\`\`javascript
import { init } from '@openaidy/addon-${addonId}';

const addon = init({
  // configuration
});

await addon.start();
\`\`\`

### Advanced Usage

\`\`\`javascript
import { init } from '@openaidy/addon-${addonId}';

const addon = init({
  debug: true,
  timeout: 5000,
});

addon.on('ready', () => {
  console.log('Addon is ready');
});

await addon.start();
\`\`\`
`;
}

/**
 * Validate API documentation
 */
export function validateApiDocs(docs: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!docs.includes('## Methods')) {
    warnings.push('API docs missing Methods section');
  }

  if (!docs.includes('## Events')) {
    warnings.push('API docs missing Events section');
  }

  if (docs.length < 100) {
    errors.push('API docs appear to be incomplete');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
