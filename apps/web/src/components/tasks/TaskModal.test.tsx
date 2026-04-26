import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@solidjs/testing-library';
import { TaskModal } from './TaskModal';

describe('TaskModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn().mockResolvedValue(undefined);
  const mockAgents = [{ id: 'agent-1', name: 'Test Agent', enabled: true }];

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSubmit: mockOnSubmit,
    agents: mockAgents,
  };

  describe('submit button text', () => {
    it('should show "Create" when creating a new task', () => {
      const { getByRole } = render(() => TaskModal(defaultProps));

      const submitButton = getByRole('button', { name: /create/i });
      expect(submitButton).toBeTruthy();
    });

    it('should show "Update" when editing an existing task', () => {
      const existingTask = {
        id: 'task-123',
        title: 'Existing Task',
        description: 'Task description',
        status: 'backlog' as const,
        priority: 'medium' as const,
        planningEnabled: false,
        planningStatus: null,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };

      const { getByRole } = render(() =>
        TaskModal({ ...defaultProps, task: existingTask }),
      );

      const submitButton = getByRole('button', { name: /update/i });
      expect(submitButton).toBeTruthy();
    });

    it('should show "Saving..." while submitting', async () => {
      // Create a delayed submit to keep it in loading state
      const delayedSubmit = vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
      );

      const { getByRole, getByPlaceholderText } = render(() =>
        TaskModal({ ...defaultProps, onSubmit: delayedSubmit }),
      );

      // Fill in required fields
      const titleInput = getByPlaceholderText('Enter task title');
      const descriptionInput = getByPlaceholderText(
        'Enter task description (the prompt for the agent)',
      );

      fireEvent.input(titleInput, { target: { value: 'Test Task' } });
      fireEvent.input(descriptionInput, {
        target: { value: 'Test Description' },
      });

      // Submit the form
      const submitButton = getByRole('button', { name: /create/i });
      fireEvent.click(submitButton);

      // Check that button now shows "Saving..."
      await waitFor(() => {
        const savingButton = getByRole('button', { name: /saving/i });
        expect(savingButton).toBeTruthy();
      });
    });

    it('should reset button text after submission error', async () => {
      const failingSubmit = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));

      const { getByRole, getByPlaceholderText } = render(() =>
        TaskModal({ ...defaultProps, onSubmit: failingSubmit }),
      );

      // Fill in required fields
      const titleInput = getByPlaceholderText('Enter task title');
      const descriptionInput = getByPlaceholderText(
        'Enter task description (the prompt for the agent)',
      );

      fireEvent.input(titleInput, { target: { value: 'Test Task' } });
      fireEvent.input(descriptionInput, {
        target: { value: 'Test Description' },
      });

      // Submit the form
      const submitButton = getByRole('button', { name: /create/i });
      fireEvent.click(submitButton);

      // Wait for error to complete (button should reset from "Saving..." back to "Create")
      await waitFor(() => {
        const createButton = getByRole('button', { name: /create/i });
        expect(createButton).toBeTruthy();
        // Button should be enabled again (not disabled from loading state)
        expect((createButton as HTMLButtonElement).disabled).toBe(false);
      });
    });

    it('should disable submit button while loading', async () => {
      const delayedSubmit = vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
      );

      const { getByRole, getByPlaceholderText } = render(() =>
        TaskModal({ ...defaultProps, onSubmit: delayedSubmit }),
      );

      // Fill in required fields
      const titleInput = getByPlaceholderText('Enter task title');
      const descriptionInput = getByPlaceholderText(
        'Enter task description (the prompt for the agent)',
      );

      fireEvent.input(titleInput, { target: { value: 'Test Task' } });
      fireEvent.input(descriptionInput, {
        target: { value: 'Test Description' },
      });

      // Submit the form
      const submitButton = getByRole('button', { name: /create/i });
      fireEvent.click(submitButton);

      // Check that button is disabled while loading
      await waitFor(() => {
        expect((submitButton as HTMLButtonElement).disabled).toBe(true);
      });
    });
  });

  describe('form validation', () => {
    it('should show validation errors for empty required fields', async () => {
      const { getByRole, getByText } = render(() => TaskModal(defaultProps));

      // Try to submit without filling fields
      const submitButton = getByRole('button', { name: /create/i });
      fireEvent.click(submitButton);

      // Should show validation errors
      await waitFor(() => {
        expect(getByText('Title is required')).toBeTruthy();
        expect(getByText('Description is required')).toBeTruthy();
      });
    });
  });

  describe('modal behavior', () => {
    it('should call onClose when clicking cancel button', () => {
      const { getByRole } = render(() => TaskModal(defaultProps));

      const cancelButton = getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should not render when isOpen is false', () => {
      const { container } = render(() =>
        TaskModal({ ...defaultProps, isOpen: false }),
      );

      // Modal should not be in the DOM
      expect(container.querySelector('.fixed')).toBeFalsy();
    });
  });
});
