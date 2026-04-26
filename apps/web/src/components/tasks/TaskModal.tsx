/**
 * Task Modal Component
 *
 * Modal for creating and editing tasks with title, description,
 * priority selection, planning toggle, and agent assignment.
 */

import { createSignal, Show, For, createEffect, on } from 'solid-js';
import { X } from 'lucide-solid';
import { AgentSelector, type Agent, type SelectedAgent } from './AgentSelector';
import type { Task, TaskPriority, CreateTaskInput } from '../../lib/api-tasks';

/**
 * TaskModal Props
 */
export type TaskModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (input: CreateTaskInput) => Promise<void>;
  task?: Task; // For editing existing task
  initialSelectedAgents?: SelectedAgent[];
  agents: Agent[];
  isLoading?: boolean;
  onTaskCreated?: (task: Task) => void;
  onTaskUpdated?: (task: Task) => void;
};

/**
 * Priority options
 */
const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

/**
 * TaskModal Component
 */
export function TaskModal(props: TaskModalProps) {
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [priority, setPriority] = createSignal<TaskPriority>('medium');
  const [planningEnabled, setPlanningEnabled] = createSignal(false);
  const [selectedAgents, setSelectedAgents] = createSignal<SelectedAgent[]>([]);
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [submitting, setSubmitting] = createSignal(false);

  // Reset form when modal opens or task changes
  createEffect(
    on(
      () => [props.isOpen, props.task, props.initialSelectedAgents],
      () => {
        if (props.isOpen) {
          if (props.task) {
            // Edit mode - populate form
            setTitle(props.task.title);
            setDescription(props.task.description);
            setPriority(props.task.priority);
            setPlanningEnabled(props.task.planningEnabled);
            setSelectedAgents(props.initialSelectedAgents ?? []);
          } else {
            // Create mode - reset form
            setTitle('');
            setDescription('');
            setPriority('medium');
            setPlanningEnabled(false);
            setSelectedAgents([]);
          }
          setErrors({});
          setSubmitting(false);
        }
      },
    ),
  );

  /**
   * Validate form
   */
  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!title().trim()) {
      newErrors.title = 'Title is required';
    }

    if (!description().trim()) {
      newErrors.description = 'Description is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  /**
   * Handle form submission
   */
  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setErrors({});

    try {
      if (!props.onSubmit) {
        setSubmitting(false);
        return;
      }
      await props.onSubmit({
        title: title().trim(),
        description: description().trim(),
        priority: priority(),
        planningEnabled: planningEnabled(),
        agents: selectedAgents().map((a) => ({
          agentId: a.agentId,
          role: a.role,
        })),
      });

      // Reset form on success
      setTitle('');
      setDescription('');
      setPriority('medium');
      setPlanningEnabled(false);
      setSelectedAgents([]);
      setSubmitting(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to create task';
      setErrors({ submit: errorMessage });
      setSubmitting(false);
    }
  }

  // Add event listener when modal is open
  createEffect(
    on(
      () => props.isOpen,
      () => {
        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            props.onClose();
          }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
      },
    ),
  );

  const isLoading = () => props.isLoading || submitting();

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70"
        onClick={props.onClose}
      >
        <div
          class="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-lg shadow-xl w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between p-4 border-b dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {props.task ? 'Edit Task' : 'Create Task'}
            </h2>
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              onClick={props.onClose}
              disabled={isLoading()}
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} class="p-4 space-y-4">
            {/* Title */}
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                class={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 ${
                  errors().title
                    ? 'border-red-500'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                placeholder="Enter task title"
                maxlength={100}
                disabled={isLoading()}
              />
              <Show when={errors().title}>
                <p class="text-sm text-red-500">{errors().title}</p>
              </Show>
            </div>

            {/* Description */}
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description <span class="text-red-500">*</span>
              </label>
              <textarea
                class={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100 ${
                  errors().description
                    ? 'border-red-500'
                    : 'border-gray-300 dark:border-gray-600'
                } resize-none`}
                rows={4}
                value={description()}
                onInput={(e) => setDescription(e.target.value)}
                placeholder="Enter task description (the prompt for the agent)"
                disabled={isLoading()}
              />
              <Show when={errors().description}>
                <p class="text-sm text-red-500">{errors().description}</p>
              </Show>
            </div>

            {/* Priority */}
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Priority
              </label>
              <select
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100"
                value={priority()}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                disabled={isLoading()}
              >
                <For each={PRIORITY_OPTIONS}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
            </div>

            {/* Planning toggle */}
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 dark:bg-gray-900"
                  checked={planningEnabled()}
                  onChange={(e) => setPlanningEnabled(e.target.checked)}
                  disabled={isLoading()}
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">
                  Enable planning mode
                </span>
              </label>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Let the agent break down the task into subtasks automatically
              </p>
            </div>

            {/* Agent selector */}
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Assign Agents
              </label>
              <AgentSelector
                agents={props.agents}
                selectedAgents={selectedAgents()}
                onChange={setSelectedAgents}
                disabled={isLoading()}
              />
            </div>

            {/* Actions */}
            <div class="flex items-center justify-end gap-3 pt-4 border-t dark:border-gray-700">
              <button
                type="button"
                class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-md dark:hover:border-gray-500"
                onClick={props.onClose}
                disabled={isLoading()}
              >
                Cancel
              </button>
              <button
                type="submit"
                class={`px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
                  isLoading() ? '' : ''
                }`}
                disabled={isLoading()}
              >
                <Show
                  when={isLoading()}
                  fallback={props.task ? 'Update' : 'Create'}
                >
                  Saving...
                </Show>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
