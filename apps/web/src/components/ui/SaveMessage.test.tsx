import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { SaveMessage, type SaveMessageType } from './SaveMessage';
import { createSignal } from 'solid-js';

describe('SaveMessage', () => {
  beforeEach(() => {
    cleanup();
  });

  it('should not render when message is null', () => {
    const message = () => null as SaveMessageType;
    const { container } = render(() => <SaveMessage message={message} />);

    expect(container.innerHTML).toBe('');
  });

  it('should render success message', () => {
    const message = () => ({
      type: 'success' as const,
      text: 'Saved successfully!',
    });
    const { container } = render(() => <SaveMessage message={message} />);

    expect(container).toHaveTextContent('Saved successfully!');
    expect(container.querySelector('.bg-green-50')).toBeInTheDocument();
  });

  it('should render error message', () => {
    const message = () => ({ type: 'error' as const, text: 'Failed to save!' });
    const { container } = render(() => <SaveMessage message={message} />);

    expect(container).toHaveTextContent('Failed to save!');
    expect(container.querySelector('.bg-red-50')).toBeInTheDocument();
  });

  it('should update when message changes', () => {
    const [message, setMessage] = createSignal<SaveMessageType>(null);
    const { container } = render(() => <SaveMessage message={message} />);

    expect(container.innerHTML).toBe('');

    setMessage({ type: 'success', text: 'Success!' });
    expect(container).toHaveTextContent('Success!');

    setMessage({ type: 'error', text: 'Error!' });
    expect(container).toHaveTextContent('Error!');

    setMessage(null);
    expect(container.innerHTML).toBe('');
  });
});
