import { describe, it, expect, vi } from 'vitest';
import { bareId, extractText, resolveSenderIds } from './inbound.js';

describe('bareId', () => {
  it('strips the @s.whatsapp.net server', () => {
    expect(bareId('15551234567@s.whatsapp.net')).toBe('15551234567');
  });

  it('strips the @lid server', () => {
    expect(bareId('111222333@lid')).toBe('111222333');
  });

  it('strips a device suffix', () => {
    expect(bareId('15551234567:12@s.whatsapp.net')).toBe('15551234567');
  });

  it('returns empty string for nullish input', () => {
    expect(bareId(undefined)).toBe('');
    expect(bareId(null)).toBe('');
  });
});

describe('extractText', () => {
  it('reads a plain conversation message', () => {
    expect(extractText({ conversation: 'hello' })).toBe('hello');
  });

  it('reads an extended text message', () => {
    expect(extractText({ extendedTextMessage: { text: 'hi there' } })).toBe(
      'hi there',
    );
  });

  it('unwraps an ephemeral (disappearing) message', () => {
    expect(
      extractText({ ephemeralMessage: { message: { conversation: 'poof' } } }),
    ).toBe('poof');
  });

  it('unwraps a view-once message', () => {
    expect(
      extractText({
        viewOnceMessageV2: {
          message: { extendedTextMessage: { text: 'once' } },
        },
      }),
    ).toBe('once');
  });

  it('returns empty string for media / non-text / null', () => {
    expect(extractText(null)).toBe('');
    expect(extractText({})).toBe('');
  });
});

describe('resolveSenderIds', () => {
  it('resolves a plain phone-number (PN) 1:1 message', async () => {
    const { primary, candidates } = await resolveSenderIds({
      remoteJid: '15551234567@s.whatsapp.net',
    });
    expect(primary).toBe('15551234567');
    expect(candidates).toContain('15551234567');
  });

  it('prefers the PN alt when the remoteJid is a LID', async () => {
    const { primary, candidates } = await resolveSenderIds({
      remoteJid: '111222333@lid',
      remoteJidAlt: '15551234567@s.whatsapp.net',
    });
    expect(primary).toBe('15551234567');
    // Both forms are matchable against an allowlist.
    expect(candidates).toEqual(
      expect.arrayContaining(['15551234567', '111222333']),
    );
  });

  it('resolves the PN behind a LID via the resolver when no alt is present', async () => {
    const resolver = vi.fn().mockResolvedValue('15551234567@s.whatsapp.net');
    const { primary, candidates } = await resolveSenderIds(
      { remoteJid: '111222333@lid' },
      resolver,
    );
    expect(resolver).toHaveBeenCalledWith('111222333@lid');
    expect(primary).toBe('15551234567');
    expect(candidates).toEqual(
      expect.arrayContaining(['15551234567', '111222333']),
    );
  });

  it('falls back to the LID when the resolver returns null', async () => {
    const resolver = vi.fn().mockResolvedValue(null);
    const { primary, candidates } = await resolveSenderIds(
      { remoteJid: '111222333@lid' },
      resolver,
    );
    expect(primary).toBe('111222333');
    expect(candidates).toEqual(['111222333']);
  });

  it('falls back to the LID when the resolver throws', async () => {
    const resolver = vi.fn().mockRejectedValue(new Error('offline'));
    const { primary } = await resolveSenderIds(
      { remoteJid: '111222333@lid' },
      resolver,
    );
    expect(primary).toBe('111222333');
  });

  it('returns empty primary when the key carries no ids', async () => {
    const { primary, candidates } = await resolveSenderIds({});
    expect(primary).toBe('');
    expect(candidates).toEqual([]);
  });
});
