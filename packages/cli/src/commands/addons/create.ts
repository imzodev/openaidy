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
import { generateFromTemplate } from '../../utils/template-generator.js';
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
      message: `Invalid template: ${template}. Valid templates are: basic, agent`,
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

    // Generate files from template
    const generated = await generateFromTemplate(template, projectPath, {
      name,
      id: addonId,
    });
    if (!generated.success) {
      fs.rmSync(projectPath, { recursive: true, force: true });
      return { success: false, message: generated.message };
    }

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

  if (!options.template) {
    const choice = await p.select({
      message: 'Choose a template',
      options: [
        {
          value: 'basic',
          label: 'basic',
          hint: 'hello world with SDK connection',
        },
        {
          value: 'agent',
          label: 'agent',
          hint: 'agent runner — select and invoke an agent',
        },
      ],
    });
    if (p.isCancel(choice)) {
      p.cancel('Cancelled.');
      return { exitCode: 1, error: 'Cancelled' };
    }
    options.template = choice as string;
  }

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
