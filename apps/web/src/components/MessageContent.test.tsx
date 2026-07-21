import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { MessageContent } from './MessageContent';
import { parseThinking } from './ThinkingBlock';

afterEach(() => cleanup());

// Stub the icons ThinkingBlock renders. Plain-object factory (not a Proxy —
// a Proxy module mock hangs vitest collection here). Test-ids match the
// kebab-case icon name so the chevron assertions below can target them.
vi.mock('lucide-solid', () => ({
  Brain: () => <span data-testid="brain" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  Copy: () => <span data-testid="copy" />,
  Check: () => <span data-testid="check" />,
}));

describe('parseThinking', () => {
  it('returns a single text part when there are no think tags', () => {
    const parts = parseThinking('Hello there!');
    expect(parts).toEqual([{ type: 'text', text: 'Hello there!' }]);
  });

  it('extracts a thinking part from a think tag', () => {
    const parts = parseThinking('<think>reasoning here</think>');
    expect(parts).toEqual([{ type: 'thinking', text: 'reasoning here' }]);
  });

  it('trims whitespace from text parts around think tags', () => {
    const parts = parseThinking('<think>thought</think>\n\nHi there!');
    expect(parts).toEqual([
      { type: 'thinking', text: 'thought' },
      { type: 'text', text: 'Hi there!' },
    ]);
  });

  it('trims whitespace inside the think tag', () => {
    const parts = parseThinking('<think>\n  deep thought\n</think>answer');
    expect(parts).toEqual([
      { type: 'thinking', text: 'deep thought' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('handles text before and after think tag', () => {
    const parts = parseThinking('preamble\n<think>thought</think>\nanswer');
    expect(parts).toEqual([
      { type: 'text', text: 'preamble' },
      { type: 'thinking', text: 'thought' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('handles multiple think tags', () => {
    const parts = parseThinking(
      '<think>first</think>mid<think>second</think>end',
    );
    expect(parts).toEqual([
      { type: 'thinking', text: 'first' },
      { type: 'text', text: 'mid' },
      { type: 'thinking', text: 'second' },
      { type: 'text', text: 'end' },
    ]);
  });

  it('omits empty think tags', () => {
    const parts = parseThinking('<think>   </think>Hello');
    expect(parts).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('returns empty array for empty string', () => {
    expect(parseThinking('')).toEqual([]);
  });
});

describe('MessageContent', () => {
  it('renders plain text with no think tags', () => {
    render(() => <MessageContent content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders the Thinking toggle button for think content', () => {
    render(() => <MessageContent content="<think>reasoning</think>Answer" />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
  });

  it('hides thinking content by default', () => {
    render(() => (
      <MessageContent content="<think>hidden thought</think>visible" />
    ));
    expect(screen.queryByText('hidden thought')).not.toBeInTheDocument();
  });

  it('reveals thinking content when the toggle is clicked', () => {
    render(() => (
      <MessageContent content="<think>revealed thought</think>text" />
    ));
    const button = screen.getByText('Thinking').closest('button')!;
    fireEvent.click(button);
    expect(screen.getByText('revealed thought')).toBeInTheDocument();
  });

  it('hides thinking content again when toggled a second time', () => {
    render(() => <MessageContent content="<think>toggle me</think>text" />);
    const button = screen.getByText('Thinking').closest('button')!;
    fireEvent.click(button);
    expect(screen.getByText('toggle me')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByText('toggle me')).not.toBeInTheDocument();
  });

  it('shows chevron-right when collapsed and chevron-down when expanded', () => {
    const { container } = render(() => (
      <MessageContent content="<think>thought</think>text" />
    ));
    expect(
      container.querySelector('[data-testid="chevron-right"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="chevron-down"]'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Thinking').closest('button')!);
    expect(
      container.querySelector('[data-testid="chevron-down"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="chevron-right"]'),
    ).not.toBeInTheDocument();
  });

  it('renders multiple think blocks and text parts', () => {
    const { container } = render(() => (
      <MessageContent content="<think>t1</think>mid<think>t2</think>end" />
    ));
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(screen.getByText('mid')).toBeInTheDocument();
    expect(screen.getByText('end')).toBeInTheDocument();
  });

  it('renders fenced code blocks via the CodeBlock wrapper with a copy button', () => {
    const { container } = render(() => (
      <MessageContent content={'```js\nconsole.log("hi");\n```'} />
    ));
    expect(container.querySelector('pre code')?.textContent).toBe(
      'console.log("hi");',
    );
    expect(
      container.querySelector('button[aria-label="Copy code"]'),
    ).toBeInTheDocument();
    expect(container).toHaveTextContent('js');
  });
});
