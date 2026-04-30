import { For, Show, createSignal, onMount } from 'solid-js';
import { Lightbulb } from 'lucide-solid';
import { Layout } from './Layout';
import { listSkills, type SkillInfo } from '../../lib/api';

function SkillCard(props: { skill: SkillInfo }) {
  return (
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 flex flex-col gap-3">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <Lightbulb class="w-4 h-4 text-primary flex-shrink-0" />
          <span class="font-medium text-sm text-text-primary truncate">
            {props.skill.name}
          </span>
        </div>
        <code class="text-xs text-text-tertiary font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded flex-shrink-0">
          {props.skill.id}
        </code>
      </div>
      <p class="text-sm text-text-secondary">{props.skill.description}</p>
    </div>
  );
}

export function SkillsPage() {
  const [skills, setSkills] = createSignal<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listSkills();
      setSkills(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    void load();
  });

  return (
    <Layout
      title="Skills"
      description="Reusable agent capabilities and tools"
      actions={
        <button
          onClick={() => void load()}
          disabled={isLoading()}
          class="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary border border-border rounded-lg hover:text-text-primary hover:border-gray-400 transition-colors disabled:opacity-50"
        >
          <div
            class={`w-4 h-4 border-b-2 border-current rounded-full ${isLoading() ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      }
    >
      {/* Loading state */}
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-48">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </Show>

      {/* Error state */}
      <Show when={!isLoading() && error()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p class="text-sm text-red-700 dark:text-red-400">{error()}</p>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!isLoading() && !error() && skills().length === 0}>
        <div class="flex flex-col items-center justify-center h-64 text-center">
          <Lightbulb class="w-12 h-12 text-text-tertiary mb-4" />
          <p class="text-text-secondary font-medium">No skills installed</p>
          <p class="text-sm text-text-tertiary mt-1">
            Skills are automatically seeded from{' '}
            <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">
              config/skills/
            </code>{' '}
            on first boot.
          </p>
        </div>
      </Show>

      {/* Skills grid */}
      <Show when={!isLoading() && skills().length > 0}>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={skills()}>{(skill) => <SkillCard skill={skill} />}</For>
        </div>
      </Show>
    </Layout>
  );
}
