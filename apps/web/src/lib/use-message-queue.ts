/**
 * Message Queue Hook
 *
 * Owns the client-side queue of user messages that are entered while the
 * agent is still responding. This hook is intentionally orchestration-free:
 * it manages queue *state and operations* only (enqueue / edit / remove /
 * dequeue / clear). The policy decisions — when to enqueue vs. send, and when
 * to drain the queue — live with the streaming orchestrator that consumes it,
 * keeping responsibilities cleanly separated (SRP).
 */

import { createSignal, type Accessor } from 'solid-js';
import type { QueuedMessage } from './types';

export interface UseMessageQueueReturn {
  /** Reactive list of queued messages, in send order. */
  items: Accessor<QueuedMessage[]>;
  /** Number of queued messages. */
  size: Accessor<number>;
  /** True when no messages are queued. */
  isEmpty: Accessor<boolean>;
  /** Append a message to the end of the queue and return the created item. */
  enqueue: (
    content: string,
    agentId?: string,
    attachmentIds?: string[],
  ) => QueuedMessage;
  /** Replace the content of a queued message by id (no-op if not found). */
  edit: (id: string, content: string) => void;
  /** Remove a queued message by id (no-op if not found). */
  remove: (id: string) => void;
  /** Remove and return the head of the queue, or undefined when empty. */
  dequeue: () => QueuedMessage | undefined;
  /** Drop all queued messages. */
  clear: () => void;
}

/**
 * Create a message queue. Ids are unique within the hook instance via a
 * monotonic counter combined with a timestamp, avoiding collisions when
 * several messages are enqueued in the same tick.
 */
export function useMessageQueue(): UseMessageQueueReturn {
  const [items, setItems] = createSignal<QueuedMessage[]>([]);
  let counter = 0;

  const enqueue = (
    content: string,
    agentId?: string,
    attachmentIds?: string[],
  ): QueuedMessage => {
    counter += 1;
    const item: QueuedMessage = {
      id: `queued-${Date.now()}-${counter}`,
      content,
      ...(agentId ? { agentId } : {}),
      ...(attachmentIds?.length ? { attachmentIds } : {}),
    };
    setItems((prev) => [...prev, item]);
    return item;
  };

  const edit = (id: string, content: string): void => {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
  };

  const remove = (id: string): void => {
    setItems((prev) => prev.filter((m) => m.id !== id));
  };

  const dequeue = (): QueuedMessage | undefined => {
    let head: QueuedMessage | undefined;
    setItems((prev) => {
      if (prev.length === 0) return prev;
      head = prev[0];
      return prev.slice(1);
    });
    return head;
  };

  const clear = (): void => {
    setItems([]);
  };

  return {
    items,
    size: () => items().length,
    isEmpty: () => items().length === 0,
    enqueue,
    edit,
    remove,
    dequeue,
    clear,
  };
}
