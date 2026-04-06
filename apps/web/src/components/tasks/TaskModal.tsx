/**
 * Task Modal Component
 *
 * Modal for creating and editing tasks with title, description, priority,
 * planning toggle, and agent assignment.
 */

import { createSignal, Show, createEffect, For } from 'solid-js';
import { Modal } from '../ui/Modal';
import { AgentSelector } from './AgentSelector';
import { createTask, updateTask, type Task, type TaskPriority } from '../../lib/api-tasks';
import type { Agent as ApiAgent } from '../../lib/api';

export type TaskModalProps = {
  isOpen: boolean;
  onClose: () => void;
  task?: Task; // For editing existing task
  agents: ApiAgent[];
  onTaskCreated?: (task: Task) => void;
  onTaskUpdated?: (task: Task) => void;
};

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function TaskModal(props: TaskModalProps) {
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [priority, setPriority] = createSignal<TaskPriority>('medium');
  const [planningEnabled, setPlanningEnabled] = createSignal(false);
  const [selectedAgentIds, setSelectedAgentIds] = createSignal<string[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [validationErrors, setValidationErrors] = createSignal<Record<string, string>>({});

  // Populate form when editing
  createEffect(() => {
    if (props.task && props.isOpen) {
      setTitle(props.task.title);
      setDescription(props.task.description);
      setPriority(props.task.priority);
      setPlanningEnabled(props.task.planningEnabled);
      // Note: agents would need to be fetched from task details
      setSelectedAgentIds([]);
    } else if (!props.isOpen) {
      // Reset form when closing
      resetForm();
    }
  });

  function resetForm() {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setPlanningEnabled(false);
    setSelectedAgentIds([]);
    setError(null);
    setValidationErrors({});
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!title().trim()) {
      errors.title = 'Title is required';
    } else if (title().length > 100) {
      errors.title = 'Title must be 100 characters or less';
    }

    if (!description().trim()) {
      errors.description = 'Description is required';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();

    if (!validate()) return;

    setIsLoading(true);
    setError(null);

    try {
      const input = {
        title: title().trim(),
        description: description().trim(),
        priority: priority(),
        planningEnabled: planningEnabled(),
        agents: selectedAgentIds().map((agentId) => ({ agentId })),
      };

      if (props.task) {
        // Update existing task
        const result = await updateTask(props.task.id, {
          title: input.title,
          description: input.description,
          priority: input.priority,
        });
        if (result.ok) {
          props.onTaskUpdated?.(result.data);
          props.onClose();
        } else {
          setError(result.error.message);
        }
      } else {
        // Create new task
        const result = await createTask(input);
        if (result.ok) {
          props.onTaskCreated?.(result.data);
          props.onClose();
        } else {
          setError(result.error.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={props.task ? 'Edit Task' : 'Create Task'}
      size="lg"
    >
      <form onSubmit={handleSubmit} class="space-y-4">
        {/* Error message */}
        <Show when={error()}>
          <div class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p class="text-sm text-red-600 dark:text-red-400">{error()}</p>
          </div>
        </Show>

        {/* Title */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Title <span class="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            maxLength={100}
            class={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 ${
              validationErrors().title
                ? 'border-red-500'
                : 'border-gray-300 dark:border-gray-600'
            }`}
            placeholder="Task title..."
          />
          <Show when={validationErrors().title}>
            <p class="mt-1 text-sm text-red-500">{validationErrors().title}</p>
          </Show>
          <p class="mt-1 text-xs text-gray-500">{title().length}/100</p>
        </div>

        {/* Description */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Description (Prompt) <span class="text-red-500">*</span>
          </label>
          <textarea
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            rows={4}
            class={`w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-y ${
              validationErrors().description
                ? 'border-red-500'
                : 'border-gray-300 dark:border-gray-600'
            }`}
            placeholder="Describe what this task should accomplish..."
          />
          <Show when={validationErrors().description}>
            <p class="mt-1 text-sm text-red-500">{validationErrors().description}</p>
          </Show>
        </div>

        {/* Priority */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Priority
          </label>
          <select
            value={priority()}
            onChange={(e) => setPriority(e.currentTarget.value as TaskPriority)}
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <For each={PRIORITIES}>
              {(p) => <option value={p}>{PRIORITY_LABELS[p]}</option>}
            </For>
          </select>
        </div>

        {/* Planning toggle */}
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="planning-enabled"
            checked={planningEnabled()}
            onChange={(e) => setPlanningEnabled(e.currentTarget.checked)}
            class="rounded border-gray-300"
          />
          <label
            for="planning-enabled"
            class="text-sm text-gray-700 dark:text-gray-300"
          >
            Enable AI planning (task will be broken into subtasks)
          </label>
        </div>

        {/* Agent selector */}
        <AgentSelector
          agents={props.agents}
          selectedIds={selectedAgentIds()}
          onChange={setSelectedAgentIds}
          disabled={isLoading()}
        />

        {/* Actions */}
        <div class="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={props.onClose}
            disabled={isLoading()}
            class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading()}
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
          >
            {isLoading()
              ? props.task
                ? 'Updating...'
                : 'Creating...'
              : props.task
                ? 'Update Task'
                : 'Create Task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
