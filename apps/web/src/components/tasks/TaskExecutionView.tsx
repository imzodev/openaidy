/**
 * Task Execution View Component
 *
 * Displays the session execution for a task or subtask, showing the conversation
 * and allowing interaction.
 */

import { createSignal, createEffect, Show, For, onCleanup } from 'solid-js';
import { X, Play, Send, Loader2 } from 'lucide-solid';
import {
  getTask,
  executeTask,
  executeSubtask,
  getTaskSession,
  getSubtaskSession,
  type Task,
  type TaskWithDetails,
} from '../../lib/api-tasks';

/**
 * Session message type
 */
type SessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

/**
 * TaskExecutionView Props
 */
export type TaskExecutionViewProps = {
  taskId: string;
  subtaskId?: string;
  onClose: () => void;
  onTaskComplete: () => void;
};

/**
 * TaskExecutionView Component
 */
export function TaskExecutionView(props: TaskExecutionViewProps) {
  const [task, setTask] = createSignal<TaskWithDetails | null>(null);
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<SessionMessage[]>([]);
  const [inputValue, setInputValue] = createSignal('');
  const [isExecuting, setIsExecuting] = createSignal(false);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Load task on mount
  createEffect(() => {
    loadTask();
  });

  /**
   * Load task and check for existing session
   */
  async function loadTask() {
    const result = await getTask(props.taskId);
    if (result.ok) {
      setTask(result.data);

      // Check for existing session
      if (result.data.sessionId) {
        setSessionId(result.data.sessionId);
        loadMessages(result.data.sessionId);
      }
    }
  }

  /**
   * Load messages for a session (simplified - would use WebSocket in production)
   */
  async function loadMessages(sid: string) {
    // In a real implementation, this would subscribe to WebSocket messages
    // For now, we'll just set an empty array
    setMessages([]);
  }

  /**
   * Start execution
   */
  async function startExecution() {
    setIsExecuting(true);
    setError(null);
    try {
      let result;
      if (props.subtaskId) {
        result = await executeSubtask(props.subtaskId);
      } else {
        result = await executeTask(props.taskId);
      }

      if (result.ok) {
        setSessionId(result.data.sessionId);
        loadMessages(result.data.sessionId);
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start execution');
    } finally {
      setIsExecuting(false);
    }
  }

  /**
   * Send a message
   */
  async function sendMessage() {
    if (!inputValue().trim() || !sessionId()) return;

    const content = inputValue().trim();
    setInputValue('');

    // Add user message to local state
    const userMessage: SessionMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // In a real implementation, this would send via WebSocket
    setIsStreaming(true);
    // Simulate streaming for demo
    setTimeout(() => {
      const assistantMessage: SessionMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'This is a placeholder response. In production, this would be streamed from the agent.',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsStreaming(false);
    }, 1000);
  }

  /**
   * Handle key press
   */
  function handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div class="task-execution-view bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div class="flex items-center justify-between p-4 border-b bg-gray-50">
        <div class="flex items-center gap-2">
          <h3 class="text-lg font-semibold text-gray-900">
            {task()?.title || 'Loading...'}
          </h3>
          <Show when={props.subtaskId}>
            <span class="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
              Subtask
            </span>
          </Show>
        </div>
        <button
          type="button"
          class="p-1.5 text-gray-400 hover:text-gray-600"
          onClick={props.onClose}
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      {/* Error state */}
      <Show when={error()}>
        <div class="p-4 bg-red-50 text-red-600 text-sm">
          {error()}
        </div>
      </Show>

      {/* Execution prompt */}
      <Show when={!sessionId()}>
        <div class="flex-1 flex items-center justify-center p-8">
          <div class="text-center">
            <div class="mb-4 text-gray-500">
              <Play class="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Ready to execute this task?</p>
            </div>
            <button
              type="button"
              class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={startExecution}
              disabled={isExecuting()}
            >
              <Show when={isExecuting()} fallback="Start Execution">
                <span class="flex items-center gap-2">
                  <Loader2 class="w-4 h-4 animate-spin" />
                  Starting...
                </span>
              </Show>
            </button>
          </div>
        </div>
      </Show>

      {/* Messages */}
      <Show when={sessionId()}>
        <div class="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          <Show when={messages().length === 0}>
            <div class="text-center text-gray-500 py-8">
              <p>Execution started. Waiting for agent response...</p>
            </div>
          </Show>

          <For each={messages()}>
            {(message) => (
              <div
                class={`p-3 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-50 ml-8'
                    : message.role === 'assistant'
                    ? 'bg-gray-50 mr-8'
                    : 'bg-yellow-50'
                }`}
              >
                <div class="text-xs text-gray-500 mb-1 capitalize">{message.role}</div>
                <div class="text-sm text-gray-900 whitespace-pre-wrap">
                  {message.content}
                </div>
                <div class="text-xs text-gray-400 mt-1">
                  {new Date(message.createdAt).toLocaleTimeString()}
                </div>
              </div>
            )}
          </For>

          {/* Streaming indicator */}
          <Show when={isStreaming()}>
            <div class="p-3 bg-gray-50 rounded-lg mr-8">
              <div class="flex items-center gap-2 text-gray-500">
                <Loader2 class="w-4 h-4 animate-spin" />
                <span class="text-sm">Agent is typing...</span>
              </div>
            </div>
          </Show>
        </div>

        {/* Input */}
        <div class="p-4 border-t bg-gray-50">
          <div class="flex gap-2">
            <textarea
              class="flex-1 px-3 py-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={inputValue()}
              onInput={(e) => setInputValue(e.currentTarget.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              disabled={isStreaming()}
            />
            <button
              type="button"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-end"
              onClick={sendMessage}
              disabled={!inputValue().trim() || isStreaming()}
            >
              <Send class="w-5 h-5" />
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
