/**
 * PulsesPage Component
 *
 * Main page for managing pulses (scheduled AI prompt executions).
 */

import { createSignal, Show, For, onMount } from 'solid-js';
import { Zap, Plus } from 'lucide-solid';
import { Layout } from './Layout';
import { PulseCard } from '../pulses/PulseCard';
import { CreateEditPulseModal } from '../pulses/CreateEditPulseModal';
import { PulseHistoryDrawer } from '../pulses/PulseHistoryDrawer';
import {
  listPulses,
  createPulse,
  updatePulse,
  deletePulse,
  triggerPulse,
  listScheduled,
  type Pulse,
  type CreatePulseBody,
  type UpdatePulseBody,
} from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';

export function PulsesPage() {
  const [pulses, setPulses] = createSignal<Pulse[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = createSignal<string | null>(
    null,
  );
  const [historyPulseId, setHistoryPulseId] = createSignal<string | null>(null);
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [editingPulse, setEditingPulse] = createSignal<Pulse | undefined>(
    undefined,
  );

  const token = () => resolveToken() ?? '';
  // Reminders agents set in conversations ("remind me Friday…").
  const [reminders, setReminders] = createSignal<Pulse[]>([]);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [data, scheduled] = await Promise.all([
        listPulses(token()),
        listScheduled(token(), 'reminder').catch(() => ({ items: [] })),
      ]);
      setPulses(data.pulses);
      setReminders(scheduled.items.filter((r) => r.status === 'active'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pulses');
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    void load();
  });

  const handleCreate = () => {
    setEditingPulse(undefined);
    setIsModalOpen(true);
  };

  const handleEdit = (pulse: Pulse) => {
    setEditingPulse(pulse);
    setIsModalOpen(true);
  };

  const handleHistory = (id: string) => {
    setHistoryPulseId(id);
  };

  const handleTrigger = async (id: string) => {
    setActionLoadingId(id);
    try {
      await triggerPulse(token(), id);
      void load();
    } catch (err) {
      console.error('Failed to trigger pulse:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePause = async (id: string) => {
    setActionLoadingId(id);
    try {
      const result = await updatePulse(token(), id, { status: 'paused' });
      setPulses((prev) => prev.map((p) => (p.id === id ? result.pulse : p)));
    } catch (err) {
      console.error('Failed to pause pulse:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleResume = async (id: string) => {
    setActionLoadingId(id);
    try {
      const result = await updatePulse(token(), id, { status: 'active' });
      setPulses((prev) => prev.map((p) => (p.id === id ? result.pulse : p)));
    } catch (err) {
      console.error('Failed to resume pulse:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this pulse?')) return;
    setActionLoadingId(id);
    try {
      await deletePulse(token(), id);
      setPulses((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to delete pulse:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancelReminder = async (id: string) => {
    if (!confirm('Cancel this reminder?')) return;
    setActionLoadingId(id);
    try {
      await deletePulse(token(), id);
      setReminders((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Failed to cancel reminder:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleModalSubmit = async (body: CreatePulseBody | UpdatePulseBody) => {
    if (editingPulse()) {
      // Edit mode - partial update
      const updateBody = body as UpdatePulseBody;
      const result = await updatePulse(token(), editingPulse()!.id, updateBody);
      setPulses((prev) =>
        prev.map((p) => (p.id === editingPulse()!.id ? result.pulse : p)),
      );
    } else {
      // Create mode
      const result = await createPulse(token(), body as CreatePulseBody);
      setPulses((prev) => [result.pulse, ...prev]);
    }
    setIsModalOpen(false);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
  };

  return (
    <Layout
      title="Pulses"
      description="Scheduled AI prompt executions"
      actions={
        <button
          onClick={handleCreate}
          class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium"
        >
          <Plus class="w-4 h-4" />
          New Pulse
        </button>
      }
    >
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-64">
          <div class="animate-pulse text-text-tertiary">Loading pulses...</div>
        </div>
      </Show>

      <Show when={!isLoading() && error()}>
        <div class="text-center py-12">
          <p class="text-red-600 dark:text-red-400 mb-4">{error()}</p>
          <button
            onClick={() => void load()}
            class="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </Show>

      <Show when={!isLoading() && !error() && pulses().length === 0}>
        <div class="text-center py-12">
          <Zap class="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <h3 class="text-lg font-medium text-text-primary mb-2">
            No pulses yet
          </h3>
          <p class="text-text-secondary mb-4">
            Create your first pulse to schedule AI prompt executions
          </p>
          <button
            onClick={handleCreate}
            class="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors"
          >
            Create Pulse
          </button>
        </div>
      </Show>

      <Show when={!isLoading() && !error() && pulses().length > 0}>
        <div class="grid gap-4">
          <For each={pulses()}>
            {(pulse) => (
              <PulseCard
                pulse={pulse}
                onTrigger={handleTrigger}
                onPause={handlePause}
                onResume={handleResume}
                onEdit={handleEdit}
                onHistory={handleHistory}
                onDelete={handleDelete}
                isActionLoading={actionLoadingId() === pulse.id}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={!isLoading() && reminders().length > 0}>
        <section class="mt-8">
          <h2 class="text-sm font-semibold text-text-primary mb-1">
            Reminders
          </h2>
          <p class="text-xs text-text-tertiary mb-3">
            Set by agents from conversations. Each one runs once, back in the
            conversation it came from.
          </p>
          <ul class="divide-y divide-gray-200 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <For each={reminders()}>
              {(reminder) => (
                <li class="p-3 flex items-start gap-3 text-sm">
                  <div class="flex-1 min-w-0">
                    <div class="font-medium text-text-primary truncate">
                      {reminder.name}
                    </div>
                    <div class="text-xs text-text-tertiary">
                      {reminder.nextRunAt
                        ? new Date(reminder.nextRunAt).toLocaleString()
                        : ''}
                      <Show when={reminder.sessionId}>
                        {' · '}
                        <a
                          href={`/chat?sessionId=${reminder.sessionId}`}
                          class="text-primary hover:underline"
                        >
                          conversation
                        </a>
                      </Show>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="text-xs text-red-600 hover:underline disabled:opacity-50"
                    disabled={actionLoadingId() === reminder.id}
                    onClick={() => void handleCancelReminder(reminder.id)}
                  >
                    Cancel
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <CreateEditPulseModal
        isOpen={isModalOpen()}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
        pulse={editingPulse()}
      />

      <PulseHistoryDrawer
        pulseId={historyPulseId()}
        onClose={() => setHistoryPulseId(null)}
      />
    </Layout>
  );
}
