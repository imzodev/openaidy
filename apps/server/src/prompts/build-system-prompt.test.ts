import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './build-system-prompt';
import type { AgentPersonalityService } from '../agents/personality-service';
import type { ToolDefinition } from '@openaidy/runtime';

function mockPersonality(blank: string[]): AgentPersonalityService {
  return {
    readAllForInjection: async () => [],
    getBlankFileLabels: async () => blank,
  } as unknown as AgentPersonalityService;
}

describe('buildSystemPrompt — onboarding block (#373)', () => {
  it('is discretion-based, not a blanket "ask before answering"', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      personalityService: mockPersonality(['Mission', 'Agent Identity']),
      onboardingMessagesRemaining: 2,
    });
    expect(prompt).toContain('[ONBOARDING]');
    expect(prompt).toContain('DO NOT onboard right now');
    expect(prompt).toContain('DO onboard now only if');
    // The forced-onboarding phrasing must be gone.
    expect(prompt).not.toContain('Before answering');
    // Still persists via workspace_write, not memory tools.
    expect(prompt).toContain('workspace_write');
  });

  it('orders blank items by priority (Mission before Agent Identity)', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      // Deliberately out of priority order in the input.
      personalityService: mockPersonality(['Agent Identity', 'Mission']),
      onboardingMessagesRemaining: 2,
    });
    expect(prompt.indexOf('MISSION.md')).toBeLessThan(
      prompt.indexOf('AGENT.md'),
    );
  });

  it('omits onboarding once the counter is exhausted', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      personalityService: mockPersonality(['Mission']),
      onboardingMessagesRemaining: 0,
    });
    expect(prompt).not.toContain('[ONBOARDING]');
  });

  it('omits onboarding when no personality files are blank', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      personalityService: mockPersonality([]),
      onboardingMessagesRemaining: 2,
    });
    expect(prompt).not.toContain('[ONBOARDING]');
  });
});

describe('buildSystemPrompt — [ADDONS_AVAILABLE] block', () => {
  const ADDON_TOOL = {
    name: 'addon_update',
    description: 'update an addon',
    parameters: { type: 'object', properties: {} },
  } as unknown as ToolDefinition;

  const OTHER_TOOL = {
    name: 'workspace_read',
    description: 'read a file',
    parameters: { type: 'object', properties: {} },
  } as unknown as ToolDefinition;

  const ADDONS = [
    {
      id: 'weather',
      name: 'Weather Widget',
      description: 'Shows the weather',
      version: '1.2.0',
      status: 'enabled',
    },
    { id: 'broken-one', name: 'Broken', status: 'error' },
  ];

  it('lists the installed addons when the agent holds an addon tool', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      tools: [ADDON_TOOL],
      addons: ADDONS,
    });
    expect(prompt).toContain('[ADDONS_AVAILABLE]');
    expect(prompt).toContain(
      '- weather: Weather Widget v1.2.0 — Shows the weather',
    );
    // The id the addon_* tools take must be what is listed.
    expect(prompt).toContain('addon_read({ addon_id: "<id>" })');
  });

  it('reports a non-enabled addon with its actual state, not just "disabled"', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      tools: [ADDON_TOOL],
      addons: ADDONS,
    });
    // An agent asked to fix a broken addon has to be able to see it is broken.
    expect(prompt).toContain('- broken-one: Broken (error)');
  });

  it('warns that addon_update overwrites, so files must be read first', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      tools: [ADDON_TOOL],
      addons: ADDONS,
    });
    expect(prompt).toContain('OVERWRITES');
    expect(prompt).toContain('OUTSIDE your workspace');
  });

  it('omits the block for an agent with no addon tool', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      tools: [OTHER_TOOL],
      addons: ADDONS,
    });
    expect(prompt).not.toContain('[ADDONS_AVAILABLE]');
  });

  it('omits the block when no addons are installed', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      tools: [ADDON_TOOL],
      addons: [],
    });
    expect(prompt).not.toContain('[ADDONS_AVAILABLE]');
  });
});

describe('buildSystemPrompt — workspace:// external-tool guidance', () => {
  const WORKSPACE_READ_TOOL: ToolDefinition = {
    name: 'workspace_read',
    description: 'Read a file from your workspace',
    parameters: { type: 'object' },
  };
  const OTHER_TOOL: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web',
    parameters: { type: 'object' },
  };

  it('documents the workspace:// convention when workspace_read is available', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      tools: [WORKSPACE_READ_TOOL],
    });
    expect(prompt).toContain('workspace://<relative-path>');
    expect(prompt).toContain('image_source: "workspace://tickets/receipt.jpg"');
  });

  it('omits the guidance when workspace_read is not available', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      tools: [OTHER_TOOL],
    });
    expect(prompt).not.toContain('workspace://<relative-path>');
  });
});
