import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { CollapsibleCard } from './CollapsibleCard';

// Stub the icons CollapsibleCard renders. Plain-object factory
// (a Proxy module mock hangs vitest collection here). Trash2 uses the `trash`
// testid so the existing delete-button assertions keep working.
vi.mock('lucide-solid', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  Trash2: () => <span data-testid="trash" />,
}));

describe('CollapsibleCard', () => {
  beforeEach(() => {
    cleanup();
  });

  it('should render title', () => {
    const { container } = render(() => (
      <CollapsibleCard title="Test Card">
        <p>Content</p>
      </CollapsibleCard>
    ));

    expect(container).toHaveTextContent('Test Card');
  });

  it('should render index when provided', () => {
    const { container } = render(() => (
      <CollapsibleCard title="Test Card" index={0}>
        <p>Content</p>
      </CollapsibleCard>
    ));

    expect(container).toHaveTextContent('#1');
  });

  it('should render badge when provided', () => {
    const { container } = render(() => (
      <CollapsibleCard
        title="Test Card"
        badge="openai-compatible"
        badgeVariant="info"
      >
        <p>Content</p>
      </CollapsibleCard>
    ));

    expect(container).toHaveTextContent('openai-compatible');
  });

  it('should render description when provided', () => {
    const { container } = render(() => (
      <CollapsibleCard title="Test Card" description="A description">
        <p>Content</p>
      </CollapsibleCard>
    ));

    expect(container).toHaveTextContent('A description');
  });

  it('should render enabled badge when showEnabled and enabled', () => {
    const { container } = render(() => (
      <CollapsibleCard title="Test Card" showEnabled={true} enabled={true}>
        <p>Content</p>
      </CollapsibleCard>
    ));

    expect(container).toHaveTextContent('enabled');
  });

  it('should not render enabled badge when not enabled', () => {
    const { container } = render(() => (
      <CollapsibleCard title="Test Card" showEnabled={true} enabled={false}>
        <p>Content</p>
      </CollapsibleCard>
    ));

    expect(container).not.toHaveTextContent('enabled');
  });

  it('should show content by default', () => {
    const { container } = render(() => (
      <CollapsibleCard title="Test Card">
        <p>Test Content</p>
      </CollapsibleCard>
    ));

    expect(container).toHaveTextContent('Test Content');
  });

  it('should hide content when initiallyCollapsed is true', () => {
    const { container } = render(() => (
      <CollapsibleCard title="Test Card" initiallyCollapsed={true}>
        <p>Test Content</p>
      </CollapsibleCard>
    ));

    expect(container).not.toHaveTextContent('Test Content');
  });

  it('should toggle content visibility when collapse button is clicked', () => {
    const { container, getByTestId } = render(() => (
      <CollapsibleCard title="Test Card">
        <p>Test Content</p>
      </CollapsibleCard>
    ));

    // Content is visible initially
    expect(container).toHaveTextContent('Test Content');

    // Click collapse button
    fireEvent.click(getByTestId('chevron-down'));

    // Content should be hidden
    expect(container).not.toHaveTextContent('Test Content');

    // Click expand button
    fireEvent.click(getByTestId('chevron-right'));

    // Content should be visible again
    expect(container).toHaveTextContent('Test Content');
  });

  it('should call onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    const { getByTestId } = render(() => (
      <CollapsibleCard title="Test Card" onDelete={onDelete}>
        <p>Content</p>
      </CollapsibleCard>
    ));

    fireEvent.click(getByTestId('trash'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('should not render delete button when onDelete is not provided', () => {
    const { queryByTestId } = render(() => (
      <CollapsibleCard title="Test Card">
        <p>Content</p>
      </CollapsibleCard>
    ));

    expect(queryByTestId('trash')).not.toBeInTheDocument();
  });

  it('should disable delete button when isPending is true', () => {
    const onDelete = vi.fn();
    const { getByTestId } = render(() => (
      <CollapsibleCard title="Test Card" onDelete={onDelete} isPending={true}>
        <p>Content</p>
      </CollapsibleCard>
    ));

    const deleteButton = getByTestId('trash').closest('button');
    expect(deleteButton).toBeDisabled();
  });
});
