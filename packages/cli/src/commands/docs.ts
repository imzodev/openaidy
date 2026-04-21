/**
 * Docs Command - Generate documentation for addon projects
 */

import { generateDocs, validateDocs } from '../utils/docs-generator.js';
import { generateApiDocsFromSource } from '../utils/api-docs.js';

export interface DocsOptions {
  format?: 'markdown' | 'html' | 'json';
  output?: string;
  validate?: boolean;
  api?: boolean;
}

export interface DocsResult {
  success: boolean;
  message: string;
  outputPath?: string;
}

/**
 * Generate documentation for an addon project
 */
export async function generateAddonDocs(
  projectPath: string = process.cwd(),
  options: DocsOptions = {},
): Promise<DocsResult> {
  const { format = 'markdown', output, api = true } = options;

  // Validate project first
  if (!projectPath || !projectPath.trim()) {
    return { success: false, message: 'Project path is required' };
  }

  // Generate main documentation
  const result = await generateDocs(projectPath, {
    format,
    outputDir: output,
    includeApi: api,
  });

  return result;
}

/**
 * Validate documentation completeness
 */
export async function validateAddonDocs(
  projectPath: string = process.cwd(),
): Promise<{ valid: boolean; missing: string[]; suggestions: string[] }> {
  return validateDocs(projectPath);
}

/**
 * Generate API documentation from source
 */
export async function generateSourceApiDocs(
  projectPath: string = process.cwd(),
  options: { includePrivate?: boolean; output?: string } = {},
): Promise<DocsResult> {
  try {
    const result = await generateApiDocsFromSource(projectPath, {
      includePrivate: options.includePrivate,
    });

    if (options.output) {
      const fs = await import('node:fs');
      fs.writeFileSync(options.output, result.content);
      return {
        success: true,
        message: `API documentation written to ${options.output}`,
        outputPath: options.output,
      };
    }

    return {
      success: true,
      message: 'API documentation generated successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to generate API docs: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Print documentation status
 */
export function printDocsStatus(result: ReturnType<typeof validateDocs>): void {
  if (result.valid) {
    console.log('✓ Documentation is complete');
  } else {
    console.log('✗ Documentation is incomplete');
    console.log('\nMissing files:');
    for (const item of result.missing) {
      console.log(`  - ${item}`);
    }
    console.log('\nSuggestions:');
    for (const suggestion of result.suggestions) {
      console.log(`  - ${suggestion}`);
    }
  }
}
