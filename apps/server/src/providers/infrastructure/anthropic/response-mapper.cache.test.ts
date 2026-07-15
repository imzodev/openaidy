import { describe, it, expect } from 'vitest';
import { mapUsage, mapStreamEvent } from './response-mapper';
import type { AnthropicStreamEvent } from './types';

describe('anthropic mapUsage — cache tokens', () => {
  it('sums input + cache read + cache creation into promptTokens', () => {
    const usage = mapUsage({
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 100,
    });
    // promptTokens = 1000 + 300 + 100
    expect(usage.promptTokens).toBe(1400);
    expect(usage.completionTokens).toBe(200);
    expect(usage.totalTokens).toBe(1600);
    expect(usage.cacheReadTokens).toBe(300);
    expect(usage.cacheCreationTokens).toBe(100);
  });

  it('omits cache fields when not reported', () => {
    const usage = mapUsage({ input_tokens: 1000, output_tokens: 200 });
    expect(usage.promptTokens).toBe(1000);
    expect(usage.cacheReadTokens).toBeUndefined();
    expect(usage.cacheCreationTokens).toBeUndefined();
  });
});

describe('anthropic mapStreamEvent — message_delta usage', () => {
  const deltaEvent: AnthropicStreamEvent = {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 250 },
  };

  it('combines prompt usage from message_start with delta output tokens', () => {
    const events = [
      ...mapStreamEvent(deltaEvent, 'anthropic', 'stream_1', 'claude', {
        promptTokens: 1200,
        cacheReadTokens: 400,
        cacheCreationTokens: 100,
      }),
    ];
    const usageEvent = events.find((e) => e.type === 'stream.usage');
    expect(usageEvent).toBeDefined();
    if (usageEvent && usageEvent.type === 'stream.usage') {
      expect(usageEvent.usage.promptTokens).toBe(1200);
      expect(usageEvent.usage.completionTokens).toBe(250);
      expect(usageEvent.usage.totalTokens).toBe(1450);
      expect(usageEvent.usage.cacheReadTokens).toBe(400);
      expect(usageEvent.usage.cacheCreationTokens).toBe(100);
    }
  });

  it('falls back to promptTokens 0 when no prompt usage captured', () => {
    const events = [
      ...mapStreamEvent(deltaEvent, 'anthropic', 'stream_1', 'claude'),
    ];
    const usageEvent = events.find((e) => e.type === 'stream.usage');
    if (usageEvent && usageEvent.type === 'stream.usage') {
      expect(usageEvent.usage.promptTokens).toBe(0);
      expect(usageEvent.usage.completionTokens).toBe(250);
    }
  });
});
