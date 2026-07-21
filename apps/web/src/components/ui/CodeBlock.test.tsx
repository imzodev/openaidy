import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { CodeBlock } from './CodeBlock';

vi.mock('lucide-solid', () => ({
  Copy: () => <span data-testid="copy" />,
  Check: () => <span data-testid="check" />,
}));

afterEach(() => cleanup());

describe('CodeBlock', () => {
  it('renders the code body inside a <pre><code>', () => {
    const { container } = render(() => (
      <CodeBlock code={'console.log("hi")'} language="js" />
    ));
    expect(container.querySelector('pre code')?.textContent).toBe(
      'console.log("hi")',
    );
  });

  it('shows the language label when a language is provided', () => {
    const { container } = render(() => (
      <CodeBlock code="x = 1" language="python" />
    ));
    expect(container).toHaveTextContent('python');
  });

  it('omits the language label when none is provided', () => {
    const { container } = render(() => <CodeBlock code="x = 1" />);
    const label = container.querySelector(
      '.uppercase.tracking-wide',
    ) as HTMLElement | null;
    expect(label).toBeNull();
  });

  it('exposes a copy button targeting the code body', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { container } = render(() => (
      <CodeBlock code={'echo "hi"'} language="sh" />
    ));
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Copy code');
  });
});
