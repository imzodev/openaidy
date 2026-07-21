import { describe, it, expect } from 'vitest';
import { createRoot } from 'solid-js';
import { useMessageQueue } from './use-message-queue';

describe('useMessageQueue', () => {
  it('enqueues messages in order and reports size', () => {
    createRoot((dispose) => {
      const q = useMessageQueue();
      expect(q.isEmpty()).toBe(true);

      q.enqueue('first', 'agent-1');
      q.enqueue('second');

      expect(q.size()).toBe(2);
      expect(q.isEmpty()).toBe(false);
      expect(q.items().map((m) => m.content)).toEqual(['first', 'second']);
      expect(q.items()[0].agentId).toBe('agent-1');
      expect(q.items()[1].agentId).toBeUndefined();
      dispose();
    });
  });

  it('generates unique ids for messages enqueued in the same tick', () => {
    createRoot((dispose) => {
      const q = useMessageQueue();
      q.enqueue('a');
      q.enqueue('b');
      const [a, b] = q.items();
      expect(a.id).not.toBe(b.id);
      dispose();
    });
  });

  it('edits a queued message by id', () => {
    createRoot((dispose) => {
      const q = useMessageQueue();
      const item = q.enqueue('original');
      q.edit(item.id, 'updated');
      expect(q.items()[0].content).toBe('updated');
      dispose();
    });
  });

  it('removes a queued message by id', () => {
    createRoot((dispose) => {
      const q = useMessageQueue();
      const a = q.enqueue('a');
      q.enqueue('b');
      q.remove(a.id);
      expect(q.items().map((m) => m.content)).toEqual(['b']);
      dispose();
    });
  });

  it('dequeues from the head and returns the item', () => {
    createRoot((dispose) => {
      const q = useMessageQueue();
      q.enqueue('first');
      q.enqueue('second');

      const head = q.dequeue();
      expect(head?.content).toBe('first');
      expect(q.items().map((m) => m.content)).toEqual(['second']);
      dispose();
    });
  });

  it('returns undefined when dequeuing an empty queue', () => {
    createRoot((dispose) => {
      const q = useMessageQueue();
      expect(q.dequeue()).toBeUndefined();
      dispose();
    });
  });

  it('clears all queued messages', () => {
    createRoot((dispose) => {
      const q = useMessageQueue();
      q.enqueue('a');
      q.enqueue('b');
      q.clear();
      expect(q.isEmpty()).toBe(true);
      dispose();
    });
  });
});
