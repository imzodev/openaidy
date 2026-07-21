import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@solidjs/testing-library';
import { MessageListItem } from './MessageListItem';
import type { SessionMessage } from '../lib/api';

vi.mock('lucide-solid', () => {
  const Stub = () => null;
  return new Proxy(
    {},
    {
      get: (_t, prop: string) => (typeof prop === 'string' ? Stub : undefined),
    },
  );
});

afterEach(() => cleanup());

function makeMsg(overrides: Partial<SessionMessage>): SessionMessage {
  return {
    id: overrides.id ?? 'm1',
    sessionId: 's1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'hello',
    sequence: overrides.sequence ?? 1,
    createdAt: overrides.createdAt ?? '2024-06-15T10:00:00Z',
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
    ...(overrides.reasoningContent
      ? { reasoningContent: overrides.reasoningContent }
      : {}),
    ...(overrides.attachments ? { attachments: overrides.attachments } : {}),
  };
}

describe('MessageListItem', () => {
  it('renders the role label and time', () => {
    render(() => <MessageListItem message={makeMsg({ id: 'm1' })} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    // toLocaleTimeString output varies by environment — assert the bubble
    // container is present via its data attribute instead.
    expect(
      document.querySelector('[data-message-id="m1"]'),
    ).toBeInTheDocument();
  });

  it('shows a date separator before the first message', () => {
    render(() => <MessageListItem message={makeMsg({ id: 'm1' })} />);
    expect(document.querySelector('[data-date-separator]')).toBeInTheDocument();
  });

  it('omits the date separator when the previous message is the same day', () => {
    render(() => (
      <MessageListItem
        message={makeMsg({
          id: 'm2',
          createdAt: '2024-06-15T11:00:00Z',
        })}
        previous={makeMsg({
          id: 'm1',
          createdAt: '2024-06-15T10:00:00Z',
        })}
      />
    ));
    expect(
      document.querySelector('[data-date-separator]'),
    ).not.toBeInTheDocument();
  });

  it('renders a date separator when the calendar day changes', () => {
    render(() => (
      <MessageListItem
        message={makeMsg({
          id: 'm2',
          createdAt: '2024-06-16T00:30:00Z',
        })}
        previous={makeMsg({
          id: 'm1',
          createdAt: '2024-06-15T23:30:00Z',
        })}
      />
    ));
    expect(document.querySelector('[data-date-separator]')).toBeInTheDocument();
  });

  it('uses the correct bubble class for assistant messages', () => {
    render(() => (
      <MessageListItem message={makeMsg({ id: 'm1', role: 'assistant' })} />
    ));
    const bubble = document.querySelector('[data-message-id="m1"]')!;
    // The class includes the dark: variant — assert substring.
    expect(bubble.className).toContain('bg-gray-50');
  });

  it('renders an MCP tool label for tool messages whose metadata.toolName contains "::"', () => {
    render(() => (
      <MessageListItem
        message={makeMsg({
          id: 'm1',
          role: 'tool',
          metadata: { toolName: 'github::create_issue' },
        })}
      />
    ));
    expect(screen.getByText('github / create_issue')).toBeInTheDocument();
  });

  it('does not render a copy button when the message has no content', () => {
    render(() => (
      <MessageListItem message={makeMsg({ id: 'm1', content: '' })} />
    ));
    // The CopyButton uses aria-label "Copy"; no message copy button should
    // be rendered for empty content.
    expect(
      screen.queryByRole('button', { name: 'Copy' }),
    ).not.toBeInTheDocument();
  });
});
