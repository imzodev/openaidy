import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { AgentPicker } from './AgentPicker';
import type { Agent } from '../lib/api';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'fox-agent',
    name: 'Fox Agent',
    enabled: true,
    systemPrompt: 'You are a fox.',
    model: 'openai/gpt-4o-mini',
    defaults: {},
    ...overrides,
  };
}

describe('AgentPicker', () => {
  it('shows a neutral dot (bot icon) fallback when no agent has identity', () => {
    const agents = [makeAgent()];
    const { container } = render(() => (
      <AgentPicker agents={agents} onSelect={vi.fn()} />
    ));
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).not.toContain('🦊');
  });

  it('renders the selected agent emoji in the trigger chip', () => {
    const agents = [
      makeAgent({ identity: { emoji: '🦊', accentColor: '#7C3AED' } }),
    ];
    const { container } = render(() => (
      <AgentPicker
        agents={agents}
        selectedAgentId="fox-agent"
        onSelect={vi.fn()}
      />
    ));
    expect(container.textContent).toContain('🦊');
  });

  it('renders emoji and accent-color left border on dropdown rows', () => {
    const agents = [
      makeAgent({ identity: { emoji: '🦊', accentColor: '#7C3AED' } }),
    ];
    const { getByLabelText, getByText, container } = render(() => (
      <AgentPicker agents={agents} onSelect={vi.fn()} />
    ));

    fireEvent.click(getByLabelText('Select agent'));

    expect(container.textContent).toContain('🦊');
    const row = getByText('Fox Agent').closest('button');
    // jsdom normalizes hex colors to rgb() in the serialized style attribute.
    expect(row?.getAttribute('style')).toContain('border-left');
    expect(row?.getAttribute('style')).toContain('rgb(124, 58, 237)');
  });

  it('falls back gracefully for agents without identity in the dropdown', () => {
    const agents = [makeAgent({ id: 'plain-agent', name: 'Plain Agent' })];
    const { getByLabelText, getByText } = render(() => (
      <AgentPicker agents={agents} onSelect={vi.fn()} />
    ));

    fireEvent.click(getByLabelText('Select agent'));

    const row = getByText('Plain Agent').closest('button');
    expect(row?.getAttribute('style')).toBeFalsy();
  });

  it('calls onSelect with the agent id when a row is clicked', () => {
    const onSelect = vi.fn();
    const agents = [
      makeAgent({ identity: { emoji: '🦊', accentColor: '#7C3AED' } }),
    ];
    const { getByLabelText, getByText } = render(() => (
      <AgentPicker agents={agents} onSelect={onSelect} />
    ));

    fireEvent.click(getByLabelText('Select agent'));
    fireEvent.click(getByText('Fox Agent'));

    expect(onSelect).toHaveBeenCalledWith('fox-agent');
  });
});
