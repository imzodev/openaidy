import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { MessageDateSeparator } from './MessageDateSeparator';

afterEach(() => cleanup());

describe('MessageDateSeparator', () => {
  it('renders nothing when the calendar day has not changed', () => {
    const { container } = render(() => (
      <MessageDateSeparator
        current={{ createdAt: '2024-06-15T10:30:00Z' }}
        previous={{ createdAt: '2024-06-15T09:00:00Z' }}
      />
    ));
    expect(
      container.querySelector('[data-date-separator]'),
    ).not.toBeInTheDocument();
  });

  it('renders a separator when the calendar day changes', () => {
    const { container } = render(() => (
      <MessageDateSeparator
        current={{ createdAt: '2024-06-16T00:30:00Z' }}
        previous={{ createdAt: '2024-06-15T23:30:00Z' }}
        now={new Date('2024-06-16T12:00:00Z')}
      />
    ));
    const el = container.querySelector('[data-date-separator]')!;
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('aria-label')).toBe('Today');
  });

  it('renders when there is no previous message', () => {
    const { container } = render(() => (
      <MessageDateSeparator
        current={{ createdAt: '2024-01-01T10:00:00Z' }}
        previous={undefined}
      />
    ));
    expect(
      container.querySelector('[data-date-separator]'),
    ).toBeInTheDocument();
  });
});
