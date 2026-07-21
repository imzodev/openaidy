import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { LoadMoreControl } from './LoadMoreControl';

vi.mock('lucide-solid', () => ({
  ArrowUp: () => <span data-testid="arrow-up" />,
  Loader: () => <span data-testid="loader" />,
}));

afterEach(() => cleanup());

describe('LoadMoreControl', () => {
  it('renders the button when hasMore=true and not loading', () => {
    const onLoadMore = vi.fn();
    render(() => (
      <LoadMoreControl
        hasMore={true}
        isLoadingMore={false}
        total={100}
        loaded={50}
        onLoadMore={onLoadMore}
      />
    ));
    const btn = screen.getByTestId('load-more');
    fireEvent.click(btn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows a loading label while isLoadingMore=true', () => {
    render(() => (
      <LoadMoreControl
        hasMore={true}
        isLoadingMore={true}
        total={100}
        loaded={50}
        onLoadMore={() => {}}
      />
    ));
    expect(screen.getByTestId('loading-more')).toBeInTheDocument();
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
  });

  it('hides the button and shows an end-of-history banner when hasMore=false', () => {
    render(() => (
      <LoadMoreControl
        hasMore={false}
        isLoadingMore={false}
        total={42}
        loaded={42}
        onLoadMore={() => {}}
      />
    ));
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
    expect(screen.getByTestId('end-of-history')).toHaveTextContent(
      /42 messages/,
    );
  });

  it('singularizes "message" when total is 1', () => {
    render(() => (
      <LoadMoreControl
        hasMore={false}
        isLoadingMore={false}
        total={1}
        loaded={1}
        onLoadMore={() => {}}
      />
    ));
    expect(screen.getByTestId('end-of-history')).toHaveTextContent(
      /1 message\b/,
    );
  });

  it('does not render the end-of-history banner when total is 0', () => {
    render(() => (
      <LoadMoreControl
        hasMore={false}
        isLoadingMore={false}
        total={0}
        loaded={0}
        onLoadMore={() => {}}
      />
    ));
    expect(screen.queryByTestId('end-of-history')).not.toBeInTheDocument();
  });

  it('shows the loaded/total counter when total is provided', () => {
    render(() => (
      <LoadMoreControl
        hasMore={true}
        isLoadingMore={false}
        total={100}
        loaded={50}
        onLoadMore={() => {}}
      />
    ));
    expect(screen.getByText(/Showing 50 of 100/)).toBeInTheDocument();
  });
});
