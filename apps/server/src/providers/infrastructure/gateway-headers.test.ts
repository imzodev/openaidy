import { describe, it, expect } from 'vitest';
import {
  gatewayHeaders,
  isOpenCodeHost,
  openCodeSessionId,
} from './gateway-headers.js';

describe('gateway headers', () => {
  it('recognises OpenCode hosts by hostname only', () => {
    expect(isOpenCodeHost('https://opencode.ai/zen/go/v1')).toBe(true);
    expect(isOpenCodeHost('https://opencode.ai/inference/go/openai/v1')).toBe(
      true,
    );
    expect(isOpenCodeHost('https://api.deepseek.com/v1')).toBe(false);
    expect(isOpenCodeHost('https://evil.example/opencode.ai')).toBe(false);
    expect(isOpenCodeHost('not a url')).toBe(false);
    expect(isOpenCodeHost(undefined)).toBe(false);
  });

  it('keeps the same session id for the same conversation', () => {
    expect(openCodeSessionId('wx_o86gS-XEh')).toBe('ses_wx_o86gS-XEh');
    expect(openCodeSessionId('wx_o86gS-XEh')).toBe(
      openCodeSessionId('wx_o86gS-XEh'),
    );
  });

  it('strips characters a header value should not carry', () => {
    expect(openCodeSessionId('a b\r\nc:d')).toBe('ses_abcd');
  });

  it('gives one-off calls a fresh id', () => {
    const a = openCodeSessionId(undefined);
    const b = openCodeSessionId(undefined);
    expect(a).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('adds headers only for OpenCode', () => {
    expect(gatewayHeaders('https://opencode.ai/zen/go/v1', 's1')).toMatchObject(
      { 'x-opencode-session': 'ses_s1' },
    );
    expect(gatewayHeaders('https://api.openai.com/v1', 's1')).toEqual({});
  });
});
