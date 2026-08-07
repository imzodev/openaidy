import { describe, it, expect } from 'vitest';
import {
  extractJsonObject,
  parseVerificationVerdict,
  buildRetryMessage,
} from './verification-verdict';

describe('extractJsonObject', () => {
  it('extracts a simple object', () => {
    expect(extractJsonObject('noise {"a":1} noise')).toBe('{"a":1}');
  });

  it('extracts a nested object without truncating on the inner closing brace', () => {
    const text = '{"verdict":"INCOMPLETE","reason":"missing {x} in output"}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it('does not end the match early on a brace inside a string literal', () => {
    const text =
      '{"verdict":"INCOMPLETE","reason":"code snippet: function f() { return 1; }"}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it('returns null when there is no opening brace', () => {
    expect(extractJsonObject('just plain text, no json here')).toBeNull();
  });

  it('returns null when braces never balance', () => {
    expect(extractJsonObject('{"a": 1')).toBeNull();
  });
});

describe('parseVerificationVerdict', () => {
  it('parses a COMPLETED verdict', () => {
    const result = parseVerificationVerdict(
      '{"verdict":"COMPLETED","reason":""}',
    );
    expect(result.isComplete).toBe(true);
    expect(result.rawVerdict).toBe('COMPLETED');
  });

  it('parses an INCOMPLETE verdict and prefers the structured reason', () => {
    const result = parseVerificationVerdict(
      '{"verdict":"INCOMPLETE","reason":"the headline does not appear in the tool results"}',
    );
    expect(result.isComplete).toBe(false);
    expect(result.reason).toBe(
      'the headline does not appear in the tool results',
    );
  });

  it('falls back to the raw content when reason is missing', () => {
    const content = '{"verdict":"INCOMPLETE"}';
    const result = parseVerificationVerdict(content);
    expect(result.isComplete).toBe(false);
    expect(result.reason).toBe(content);
  });

  it('falls back to the raw content when reason is a non-string (array) without throwing', () => {
    const content =
      '{"verdict":"INCOMPLETE","reason":["missing X","missing Y"]}';
    expect(() => parseVerificationVerdict(content)).not.toThrow();
    const result = parseVerificationVerdict(content);
    expect(result.isComplete).toBe(false);
    expect(result.reason).toBe(content);
  });

  it('falls back to the raw content when reason is a non-string (number) without throwing', () => {
    const content = '{"verdict":"INCOMPLETE","reason":42}';
    expect(() => parseVerificationVerdict(content)).not.toThrow();
    expect(parseVerificationVerdict(content).reason).toBe(content);
  });

  it('falls back to the plain-text heuristic when JSON parsing throws', () => {
    const content =
      '{"verdict": invalid json here} but marked INCOMPLETE overall';
    const result = parseVerificationVerdict(content);
    expect(result.isComplete).toBe(false);
    expect(result.reason).toBe(content.trim());
    expect(result.rawVerdict).toBeUndefined();
  });

  it('falls back to the plain-text heuristic when there is no JSON at all', () => {
    const result = parseVerificationVerdict('Looks good, marked as COMPLETED.');
    expect(result.isComplete).toBe(true);
  });

  it('treats mixed COMPLETED/INCOMPLETE plain text as incomplete', () => {
    const result = parseVerificationVerdict(
      'Almost COMPLETED but actually INCOMPLETE due to a missing field.',
    );
    expect(result.isComplete).toBe(false);
  });
});

describe('buildRetryMessage', () => {
  it('returns the generic message when no reason is given', () => {
    const message = buildRetryMessage(undefined, 1500);
    expect(message).toBe(
      'Please continue and complete this subtask. Focus on delivering the actual output requested. Do not ask what to do — execute the task directly.',
    );
  });

  it('includes the reason verbatim when it is under the cap', () => {
    const message = buildRetryMessage('missing the published URL', 1500);
    expect(message).toContain('missing the published URL');
    expect(message).toContain('marked incomplete');
    expect(message).not.toContain('truncated');
  });

  // Extracts the reason text the template embeds between its fixed
  // preamble and closing sentence, so counting stray 'x' characters that
  // happen to appear in the surrounding fixed wording (e.g. "execute")
  // can't produce a false pass.
  function extractEmbeddedReason(message: string): string {
    const match = message.match(
      /missing:\n\n([\s\S]*?)\n\nAddress this directly/,
    );
    if (!match) throw new Error('reason section not found in message');
    return match[1]!;
  }

  it('truncates a reason over the cap and appends a truncation marker', () => {
    const longReason = 'x'.repeat(5000);
    const message = buildRetryMessage(longReason, 1500);

    const embedded = extractEmbeddedReason(message);
    expect(embedded).toBe(
      `${'x'.repeat(1500)}\n\n[…reason truncated at 1500 chars…]`,
    );
  });

  it('does not truncate or mark a reason exactly at the cap', () => {
    const reason = 'x'.repeat(1500);
    const message = buildRetryMessage(reason, 1500);

    const embedded = extractEmbeddedReason(message);
    expect(embedded).toBe('x'.repeat(1500));
    expect(message).not.toContain('truncated');
  });

  it('truncates and marks a reason one character over the cap', () => {
    const reason = 'x'.repeat(1501);
    const message = buildRetryMessage(reason, 1500);

    const embedded = extractEmbeddedReason(message);
    expect(embedded).toBe(
      `${'x'.repeat(1500)}\n\n[…reason truncated at 1500 chars…]`,
    );
  });
});
