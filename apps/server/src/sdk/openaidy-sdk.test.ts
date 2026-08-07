/**
 * openaidy-sdk.js is a plain browser IIFE (uses window/document/localStorage
 * at load time) with no build step of its own — it's served byte-for-byte to
 * every addon iframe. These tests load the real file into a jsdom window via
 * vm.runInContext (jsdom's own eval() doesn't resolve bare `document`/
 * `localStorage` — see jsdom#... — so the internal VM context is used
 * directly) and drive it with mock `message` events, the same way a real
 * host/addon exchange works.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ADDON_THEME_TOKEN_NAMES } from '@openaidy/shared-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_PATH = path.join(__dirname, 'openaidy-sdk.js');
const SDK_SOURCE = readFileSync(SDK_PATH, 'utf-8');

/** Extracts the FALLBACK_THEME_TOKENS object literal without executing the file. */
function extractFallbackThemeTokens(): Record<string, string> {
  const match = SDK_SOURCE.match(
    /var FALLBACK_THEME_TOKENS = (\{[\s\S]*?\n\s*\});/,
  );
  if (!match) {
    throw new Error('FALLBACK_THEME_TOKENS literal not found in source');
  }
  // Single-quoted keys/values: valid JS, not valid JSON.
  return new Function(`return (${match[1]});`)();
}

type SdkWindow = {
  document: {
    documentElement: {
      classList: { contains: (c: string) => boolean };
      style: { getPropertyValue: (p: string) => string };
    };
  };
  MessageEvent: typeof MessageEvent;
  dispatchEvent: (event: Event) => void;
  parent: Window;
  localStorage: { setItem: (k: string, v: string) => void };
  matchMedia?: (query: string) => { matches: boolean };
};

/**
 * Loads the SDK into a fresh jsdom window. `setup` runs before the script
 * executes, so it can seed localStorage / stub matchMedia / pre-set the
 * `dark` class — the SDK's initial-paint probe reads all three synchronously
 * at load time, before any message can arrive.
 */
function loadSdk(setup?: (window: SdkWindow) => void): {
  window: SdkWindow;
  vmContext: vm.Context;
} {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://addon.test',
    runScripts: 'dangerously',
  });
  const window = dom.window as unknown as SdkWindow;
  setup?.(window);
  const vmContext = dom.getInternalVMContext();
  vm.runInContext(SDK_SOURCE, vmContext);
  return { window, vmContext };
}

function postFromHost(window: SdkWindow, data: unknown) {
  window.dispatchEvent(
    new window.MessageEvent('message', { data, source: window.parent }),
  );
}

function isDark(window: SdkWindow): boolean {
  return window.document.documentElement.classList.contains('dark');
}

function tokenValue(window: SdkWindow, token: string): string {
  return window.document.documentElement.style.getPropertyValue(token);
}

describe('openaidy-sdk.js theme sync', () => {
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    // The SDK logs its version on every load; keep test output clean.
    originalConsoleLog = console.log;
    console.log = () => {};
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it('keeps FALLBACK_THEME_TOKENS in sync with ADDON_THEME_TOKEN_NAMES', () => {
    const fallbackKeys = Object.keys(extractFallbackThemeTokens()).sort();
    const hostKeys = [...ADDON_THEME_TOKEN_NAMES].sort();
    // Regression guard: if the host adds/removes a theme token in
    // packages/shared-types without updating this fallback, this fails
    // loudly instead of the SDK silently dropping or misapplying it.
    expect(fallbackKeys).toEqual(hostKeys);
  });

  it('applies every token and the dark class from a full OPENAIDY_INIT', () => {
    const { window } = loadSdk();
    const tokens = extractFallbackThemeTokens();
    postFromHost(window, {
      type: 'OPENAIDY_INIT',
      theme: { mode: 'dark', tokens },
    });

    expect(isDark(window)).toBe(true);
    for (const [name, value] of Object.entries(tokens)) {
      expect(tokenValue(window, name)).toBe(value);
    }
  });

  it('removes the dark class on an OPENAIDY_THEME_CHANGED to light', () => {
    const { window } = loadSdk();
    postFromHost(window, {
      type: 'OPENAIDY_INIT',
      theme: { mode: 'dark', tokens: extractFallbackThemeTokens() },
    });
    expect(isDark(window)).toBe(true);

    postFromHost(window, {
      type: 'OPENAIDY_THEME_CHANGED',
      theme: { mode: 'light', tokens: {} },
    });
    expect(isDark(window)).toBe(false);
  });

  it('honors a host token over the fallback, and falls back for one it omits', () => {
    const { window } = loadSdk();
    postFromHost(window, {
      type: 'OPENAIDY_INIT',
      theme: { mode: 'dark', tokens: { '--bg-primary': '#ffffff' } },
    });

    expect(tokenValue(window, '--bg-primary')).toBe('#ffffff');
    expect(tokenValue(window, '--primary')).toBe(
      extractFallbackThemeTokens()['--primary'],
    );
  });

  it('applies a token the host sends that is not in the fallback list', () => {
    // Regression guard for the union-of-keys fix: a token added to
    // ADDON_THEME_TOKEN_NAMES after this fallback list would otherwise be
    // silently dropped since it's absent from FALLBACK_THEME_TOKENS.
    const { window } = loadSdk();
    postFromHost(window, {
      type: 'OPENAIDY_INIT',
      theme: { mode: 'dark', tokens: { '--brand-new-token': '#123456' } },
    });
    expect(tokenValue(window, '--brand-new-token')).toBe('#123456');
  });

  it('honors an explicitly emptied token instead of silently reapplying the fallback', () => {
    const { window } = loadSdk();
    postFromHost(window, {
      type: 'OPENAIDY_INIT',
      theme: { mode: 'dark', tokens: { '--bg-primary': '' } },
    });
    expect(tokenValue(window, '--bg-primary')).toBe('');
  });

  it.each([undefined, null, 'oops', [1, 2, 3]])(
    'falls back to the real tokens without throwing when theme.tokens is malformed (%j)',
    (malformed) => {
      const { window } = loadSdk();
      expect(() =>
        postFromHost(window, {
          type: 'OPENAIDY_INIT',
          theme: { mode: 'dark', tokens: malformed },
        }),
      ).not.toThrow();

      expect(tokenValue(window, '--primary')).toBe(
        extractFallbackThemeTokens()['--primary'],
      );
    },
  );

  it('ignores a message whose source is not window.parent', () => {
    const { window } = loadSdk();
    // A sibling iframe / window.opener / nested iframe: any window object
    // other than window.parent must not be able to drive this addon.
    const foreignSource = { fake: 'not window.parent' };
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { type: 'OPENAIDY_INIT', theme: { mode: 'dark', tokens: {} } },
        source: foreignSource as unknown as MessageEventSource,
      }),
    );
    // No dark class was ever applied because the message was rejected before
    // reaching _applyTheme (light was the resolved initial mode here).
    expect(isDark(window)).toBe(false);
  });

  it('picks a light initial paint when the host has no dark signal', () => {
    const { window } = loadSdk((w) => {
      w.matchMedia = () => ({ matches: false });
    });
    expect(isDark(window)).toBe(false);
  });

  it('picks a dark initial paint from a stored theme preference, before any INIT arrives', () => {
    const { window } = loadSdk((w) => {
      w.matchMedia = () => ({ matches: false });
      w.localStorage.setItem('theme', 'dark');
    });
    expect(isDark(window)).toBe(true);
  });

  it('falls back to the OS preference for a stored "system" theme', () => {
    const { window } = loadSdk((w) => {
      w.matchMedia = () => ({ matches: true });
      w.localStorage.setItem('theme', 'system');
    });
    expect(isDark(window)).toBe(true);
  });
});
