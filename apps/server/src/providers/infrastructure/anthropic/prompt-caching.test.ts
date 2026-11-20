import { describe, it, expect } from 'vitest';
import type { ModelRequest } from '@openaidy/runtime';
import { mapRequest } from './request-mapper';
import { mergeLeadingSystemMessages } from '../openai-compatible/request-mapper';

const request: ModelRequest = {
  model: 'claude-sonnet-4-6',
  messages: [
    { role: 'system', content: 'STABLE PROMPT' },
    { role: 'system', content: '[NOW] Tuesday' },
    { role: 'user', content: 'hi' },
  ],
  tools: [
    { name: 'a', description: 'A', parameters: { type: 'object' } },
    { name: 'b', description: 'B', parameters: { type: 'object' } },
  ],
};

describe('Anthropic prompt caching', () => {
  it('marks the stable system block, the last tool and the last message', () => {
    const result = mapRequest(request, { promptCaching: true });
    expect(result.system).toEqual([
      {
        type: 'text',
        text: 'STABLE PROMPT',
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: '[NOW] Tuesday' },
    ]);
    expect(result.tools?.[0]?.cache_control).toBeUndefined();
    expect(result.tools?.[1]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(result.messages.at(-1)?.content).toEqual([
      { type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('sends a plain system string without cache markers when disabled', () => {
    const result = mapRequest(request);
    expect(result.system).toBe('STABLE PROMPT\n\n[NOW] Tuesday');
    expect(JSON.stringify(result)).not.toContain('cache_control');
  });

  it('never marks an empty text block', () => {
    const result = mapRequest(
      {
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: '' },
        ],
      },
      { promptCaching: true },
    );
    expect(JSON.stringify(result.messages)).not.toContain('cache_control');
  });
});

describe('mergeLeadingSystemMessages', () => {
  it('joins leading system messages, stable part first', () => {
    expect(mergeLeadingSystemMessages(request.messages)).toEqual([
      { role: 'system', content: 'STABLE PROMPT\n\n[NOW] Tuesday' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('leaves a single system message untouched', () => {
    const messages = request.messages.slice(1);
    expect(mergeLeadingSystemMessages(messages)).toBe(messages);
  });
});
