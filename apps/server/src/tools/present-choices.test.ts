import { describe, it, expect } from 'vitest';
import { presentChoicesTool } from './present-choices';

describe('presentChoicesTool', () => {
  it('returns ok with JSON-serialized INTERRUPT_CHOICES including choices and question', async () => {
    const result = await presentChoicesTool.execute(
      { choices: ['Option A', 'Option B'], question: 'Pick one' },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.content);
    expect(parsed._type).toBe('INTERRUPT_CHOICES');
    expect(parsed.choices).toEqual(['Option A', 'Option B']);
    expect(parsed.question).toBe('Pick one');
  });

  it('returns ok with INTERRUPT_CHOICES and null question when question omitted', async () => {
    const result = await presentChoicesTool.execute(
      { choices: ['Yes', 'No'] },
      { agentId: 'test-agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.content);
    expect(parsed._type).toBe('INTERRUPT_CHOICES');
    expect(parsed.question).toBeNull();
    expect(parsed.choices).toEqual(['Yes', 'No']);
  });

  it('tool definition has correct name', () => {
    expect(presentChoicesTool.name).toBe('present_choices');
  });
});
