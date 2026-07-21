import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './build-system-prompt';
import type { AgentPersonalityService } from '../agents/personality-service';

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
