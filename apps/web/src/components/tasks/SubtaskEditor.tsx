/**
 * Subtask Editor Component
 *
 * Inline editor for creating and editing subtasks.
 */

import { createSignal } from 'solid-js';

/**
 * Subtask type for editing
 */
export type SubtaskEdit = {
  title: string;
  description: string;
};

/**
 * SubtaskEditor Props
 */
export type SubtaskEditorProps = {
  title?: string;
  description?: string;
  onSave: (updates: SubtaskEdit) => void;
  onCancel: () => void;
  isLoading?: boolean;
};

/**
 * SubtaskEditor Component
 */
export function SubtaskEditor(props: SubtaskEditorProps) {
  const [title, setTitle] = createSignal(props.title || '');
  const [description, setDescription] = createSignal(props.description || '');

  const handleSave = () => {
    if (!title().trim()) return;
    props.onSave({
      title: title().trim(),
      description: description().trim(),
    });
  };

  const isValid = () => title().trim().length > 0;

  return (
    <div class="subtask-editor bg-white border border-gray-200 rounded-md p-3 space-y-3">
      {/* Title input */}
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Title <span class="text-red-500">*</span>
        </label>
        <input
          type="text"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter subtask title..."
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          disabled={props.isLoading}
        />
      </div>

      {/* Description textarea */}
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <textarea
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="Enter subtask description..."
          rows={3}
          value={description()}
          onInput={(e) => setDescription(e.currentTarget.value)}
          disabled={props.isLoading}
        />
      </div>

      {/* Actions */}
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 rounded-md"
          onClick={props.onCancel}
          disabled={props.isLoading}
        >
          Cancel
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSave}
          disabled={!isValid() || props.isLoading}
        >
          {props.isLoading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
