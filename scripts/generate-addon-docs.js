#!/usr/bin/env node
/**
 * API Documentation Generator for Addons
 *
 * Generates API documentation from addon manifest files.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

/**
 * Parse addon manifest
 */
function parseManifest(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Generate Markdown documentation
 */
function generateMarkdown(manifest) {
  const lines = [];

  lines.push(`# ${manifest.name}`);
  lines.push('');
  lines.push(`**Version:** ${manifest.version}`);
  if (manifest.description) {
    lines.push(`\n${manifest.description}`);
  }
  lines.push('');

  // Author
  if (manifest.author) {
    lines.push(`**Author:** ${manifest.author.name}`);
    if (manifest.author.email) {
      lines.push(`**Email:** ${manifest.author.email}`);
    }
    lines.push('');
  }

  // Requirements
  lines.push('## Requirements');
  lines.push('');
  lines.push(
    `- OpenAidy ${manifest.openaidy.minVersion}` +
      (manifest.openaidy.maxVersion
        ? ` - ${manifest.openaidy.maxVersion}`
        : '+'),
  );
  lines.push('');

  // Permissions
  if (manifest.permissions && manifest.permissions.length > 0) {
    lines.push('## Permissions');
    lines.push('');
    lines.push('This addon requires the following permissions:');
    lines.push('');
    for (const permission of manifest.permissions) {
      lines.push(`- \`${permission}\``);
    }
    lines.push('');
  }

  // UI Configuration
  if (manifest.ui) {
    if (manifest.ui.routes && manifest.ui.routes.length > 0) {
      lines.push('## Routes');
      lines.push('');
      lines.push('| Path | Component |');
      lines.push('|------|-----------|');
      for (const route of manifest.ui.routes) {
        lines.push(`| ${route.path} | ${route.component} |`);
      }
      lines.push('');
    }
  }

  // Agents
  if (manifest.agents && manifest.agents.length > 0) {
    lines.push('## Agents');
    lines.push('');
    for (const agent of manifest.agents) {
      lines.push(`### \`${agent.id}\``);
      if (agent.description) {
        lines.push(agent.description);
      }
      lines.push(`\nRequired: ${agent.required ? 'Yes' : 'No'}`);
      lines.push('');
    }
  }

  // Configuration
  if (manifest.config) {
    lines.push('## Configuration');
    lines.push('');
    if (manifest.config.schema) {
      lines.push('```json');
      lines.push(JSON.stringify(manifest.config.schema, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  // License
  lines.push(`**License:** ${manifest.license || 'MIT'}`);

  return lines.join('\n');
}

/**
 * Find manifest files in directory
 */
function findManifests(dir, manifests = []) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        findManifests(fullPath, manifests);
      } else if (entry === 'manifest.json') {
        manifests.push(fullPath);
      }
    }
  } catch (_error) {
    // Ignore permission errors
  }
  return manifests;
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0] || '.';
  const outputPath = args[1] || './ADDON_DOCS.md';

  console.log(`Scanning for manifests in ${inputPath}...`);

  const manifests = findManifests(inputPath);

  if (manifests.length === 0) {
    console.log('No manifest files found.');
    process.exit(0);
  }

  console.log(`Found ${manifests.length} manifest(s).`);

  const allDocs = [];

  for (const manifestPath of manifests) {
    const manifest = parseManifest(manifestPath);
    if (!manifest) continue;

    console.log(`Processing: ${manifest.name || basename(manifestPath)}`);
    const docs = generateMarkdown(manifest);
    allDocs.push(docs);
  }

  const output = [
    '# Addon API Documentation',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '---',
    '',
    ...allDocs,
  ].join('\n');

  writeFileSync(outputPath, output, 'utf-8');
  console.log(`\nDocumentation written to ${outputPath}`);
}

main();
