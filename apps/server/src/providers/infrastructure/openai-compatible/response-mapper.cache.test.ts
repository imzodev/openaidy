import { describe, it, expect } from 'vitest';
import { mapUsage } from './response-mapper';

describe('openai mapUsage — cache tokens', () => {
  it('maps prompt_tokens_details.cached_tokens to cacheReadTokens', () => {
    const usage = mapUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 300 },
    });
    expect(usage.promptTokens).toBe(1000);
    expect(usage.completionTokens).toBe(200);
    expect(usage.totalTokens).toBe(1200);
    expect(usage.cacheReadTokens).toBe(300);
  });

  it('omits cacheReadTokens when prompt_tokens_details is absent', () => {
    const usage = mapUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
    });
    expect(usage.cacheReadTokens).toBeUndefined();
  });
});
