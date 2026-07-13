import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';

// Cleanup the DOM between every test so renders don't accumulate
// (jsdom persists across tests by default; multiple `render()`
// calls in the same suite would otherwise leak nodes into the
// `screen` accessor for the next test).
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia for tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();
// Mock scrollTo for jsdom — used by ChatView's auto-scroll to keep the scroll
// contained inside the chat container instead of bubbling to the document.
Element.prototype.scrollTo = vi.fn();
