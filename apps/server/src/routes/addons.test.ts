import { describe, it, expect } from 'vitest';
import { rewriteAddonHtml } from './addons';

describe('rewriteAddonHtml', () => {
  it('adds crossorigin to a local script and appends the asset token', () => {
    const html = '<script src="index.js"></script>';
    const out = rewriteAddonHtml(html, 'TOKEN');
    expect(out).toBe(
      '<script crossorigin="anonymous" src="index.js?at=TOKEN"></script>',
    );
  });

  it('adds crossorigin to the SDK script served from an absolute local path', () => {
    const html = '<script src="/sdk/openaidy-sdk.js"></script>';
    const out = rewriteAddonHtml(html, 'TOKEN');
    expect(out).toBe(
      '<script crossorigin="anonymous" src="/sdk/openaidy-sdk.js?at=TOKEN"></script>',
    );
  });

  it('does NOT add crossorigin to an external CDN script', () => {
    const html = '<script src="https://cdn.tailwindcss.com"></script>';
    const out = rewriteAddonHtml(html, 'TOKEN');
    expect(out).toBe('<script src="https://cdn.tailwindcss.com"></script>');
    expect(out).not.toContain('crossorigin');
  });

  it('leaves an already-annotated script tag untouched', () => {
    const html =
      '<script crossorigin="use-credentials" src="index.js"></script>';
    const out = rewriteAddonHtml(html, 'TOKEN');
    expect(out).toContain('crossorigin="use-credentials"');
    expect(out).not.toContain('crossorigin="anonymous"');
  });

  it('handles a mix of local and external scripts in one document', () => {
    const html = [
      '<script src="https://cdn.tailwindcss.com"></script>',
      '<script src="/sdk/openaidy-sdk.js"></script>',
      '<script src="index.js"></script>',
    ].join('\n');
    const out = rewriteAddonHtml(html, 'TOKEN');
    expect(out).toContain(
      '<script src="https://cdn.tailwindcss.com"></script>',
    );
    expect(out).toContain(
      '<script crossorigin="anonymous" src="/sdk/openaidy-sdk.js?at=TOKEN"></script>',
    );
    expect(out).toContain(
      '<script crossorigin="anonymous" src="index.js?at=TOKEN"></script>',
    );
  });
});
