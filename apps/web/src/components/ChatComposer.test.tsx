import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { ChatComposer } from './ChatComposer';

// Mock lucide-solid
vi.mock('lucide-solid', () => ({
  Send: () => <span data-testid="send-icon">S</span>,
}));

describe('ChatComposer', () => {
  const mockOnSend = vi.fn().mockResolvedValue(undefined);

  it('should render textarea', () => {
    const { container } = render(() => <ChatComposer onSend={mockOnSend} />);
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
  });

  it('should render send button', () => {
    const { container } = render(() => <ChatComposer onSend={mockOnSend} />);
    const button = container.querySelector('button[aria-label="Send message"]');
    expect(button).toBeTruthy();
  });
});
