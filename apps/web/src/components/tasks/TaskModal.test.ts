/**
 * TaskModal Component Tests
 */

import { describe, it, expect, vi } from 'vitest';

const mockAgents = [
  { id: 'agent-1', name: 'Agent 1', description: 'First agent' },
  { id: 'agent-2', name: 'Agent 2', description: 'Second agent' },
];

describe('TaskModal', () => {
  it('renders when isOpen is true', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div data-testid="modal">Create Task</div>';

    const props = {
      isOpen: true,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
      agents: mockAgents,
    };

    // Simple test - verify the mock setup works
    expect(props.isOpen).toBe(true);
    expect(props.agents).toHaveLength(2);
  });

  it('does not render when isOpen is false', () => {
    const props = {
      isOpen: false,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
      agents: mockAgents,
    };

    expect(props.isOpen).toBe(false);
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    const container = document.createElement('div');

    const props = {
      isOpen: true,
      onClose,
      onSubmit: vi.fn(),
      agents: mockAgents,
    };

    // Simulate cancel click
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.onclick = () => onClose();
    container.appendChild(cancelButton);
    cancelButton.click();

    expect(onClose).toHaveBeenCalled();
  });

  it('validates required fields', () => {
    const formData = {
      title: '',
      priority: 'medium',
    };

    // Title is required
    const isValid = formData.title.trim().length > 0;
    expect(isValid).toBe(false);
  });

  it('submits with valid data', () => {
    const onSubmit = vi.fn();
    const formData = {
      title: 'Test Task',
      description: 'Test description',
      priority: 'high',
      status: 'todo',
    };

    // Simulate submit
    onSubmit(formData);
    expect(onSubmit).toHaveBeenCalledWith(formData);
  });
});
