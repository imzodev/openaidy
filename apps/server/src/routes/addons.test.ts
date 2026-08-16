import { describe, it, expect } from 'vitest';
import { rewriteAddonHtml, buildAddonCsp } from './addons';

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

describe('buildAddonCsp', () => {
  const scriptSrcOrigins = ["'unsafe-inline'", 'http://localhost:3001'];

  it('defaults style-src/font-src/img-src/connect-src to the platform baseline when the manifest declares nothing', () => {
    const csp = buildAddonCsp(null, scriptSrcOrigins);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain(`script-src ${scriptSrcOrigins.join(' ')}`);
    // Fixed directives are always present regardless of manifest.
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'none'");
    // No media.read permission → media-src stays locked down.
    expect(csp).toContain("media-src 'none'");
  });

  it('allows media-src data: only when the manifest declares a media.read permission variant', () => {
    const withUnscoped = buildAddonCsp(
      { permissions: ['media.read'] },
      scriptSrcOrigins,
    );
    expect(withUnscoped).toContain('media-src data:');

    const withScoped = buildAddonCsp(
      { permissions: ['media.read:microphone'] },
      scriptSrcOrigins,
    );
    expect(withScoped).toContain('media-src data:');

    const withWildcard = buildAddonCsp(
      { permissions: ['media.*'] },
      scriptSrcOrigins,
    );
    expect(withWildcard).toContain('media-src data:');

    const withoutIt = buildAddonCsp(
      { permissions: ['sessions.read'] },
      scriptSrcOrigins,
    );
    expect(withoutIt).toContain("media-src 'none'");
  });

  it('extends media-src from externalMediaDomains regardless of media.read', () => {
    const withoutPermission = buildAddonCsp(
      { externalMediaDomains: ['oss.minimax.io'] },
      scriptSrcOrigins,
    );
    expect(withoutPermission).toContain('media-src https://oss.minimax.io');

    const withBoth = buildAddonCsp(
      { permissions: ['media.read'], externalMediaDomains: ['oss.minimax.io'] },
      scriptSrcOrigins,
    );
    expect(withBoth).toContain('media-src data: https://oss.minimax.io');

    const withNeither = buildAddonCsp({}, scriptSrcOrigins);
    expect(withNeither).toContain("media-src 'none'");
  });

  it('extends style-src and font-src for a Google Fonts manifest', () => {
    const csp = buildAddonCsp(
      {
        externalStyleDomains: ['fonts.googleapis.com'],
        externalFontDomains: ['fonts.gstatic.com'],
      },
      scriptSrcOrigins,
    );
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
  });

  it('still extends connect-src/img-src from externalDomains/externalImageDomains (regression check)', () => {
    const csp = buildAddonCsp(
      {
        externalDomains: ['api.open-meteo.com'],
        externalImageDomains: ['raw.githubusercontent.com'],
      },
      scriptSrcOrigins,
    );
    expect(csp).toContain("connect-src 'self' https://api.open-meteo.com");
    expect(csp).toContain(
      "img-src 'self' data: https://raw.githubusercontent.com",
    );
  });

  it('normalizes a domain entry that already has a scheme prefix', () => {
    const csp = buildAddonCsp(
      { externalStyleDomains: ['https://fonts.googleapis.com'] },
      scriptSrcOrigins,
    );
    expect(csp).toContain('https://fonts.googleapis.com');
    // No double scheme.
    expect(csp).not.toContain('https://https://');
  });

  it('drops non-string and malformed entries instead of throwing', () => {
    const csp = buildAddonCsp(
      {
        externalStyleDomains: [
          'fonts.googleapis.com',
          123,
          null,
          'not a valid host!',
        ],
      },
      scriptSrcOrigins,
    );
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).not.toContain('not a valid host');
  });
});
