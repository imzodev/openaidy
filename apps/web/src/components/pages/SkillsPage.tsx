import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { Lightbulb, Bot } from 'lucide-solid';
import { Layout } from './Layout';
import { listSkills, type SkillInfo, type SkillSource } from '../../lib/api';

type BadgeVariant = 'gray' | 'blue' | 'yellow' | 'purple';

const SOURCE_LABEL: Record<SkillSource, string> = {
  preinstalled: 'Pre-installed',
  modified: 'Modified',
  'user-global': 'Custom',
  agent: 'Agent',
};

const SOURCE_BADGE: Record<SkillSource, BadgeVariant> = {
  preinstalled: 'gray',
  modified: 'yellow',
  'user-global': 'blue',
  agent: 'purple',
};

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  yellow:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  purple:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

function SourceBadge(props: { source: SkillSource }) {
  const variant = () => SOURCE_BADGE[props.source];
  return (
    <span
      class={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${BADGE_CLASSES[variant()]}`}
    >
      {SOURCE_LABEL[props.source]}
    </span>
  );
}

function SkillCard(props: { skill: SkillInfo }) {
  return (
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-border p-4 flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <Lightbulb class="w-4 h-4 text-primary flex-shrink-0" />
          <span class="font-medium text-sm text-text-primary truncate">
            {props.skill.name}
          </span>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <Show when={props.skill.source}>
            <SourceBadge source={props.skill.source!} />
          </Show>
        </div>
      </div>
      <p class="text-sm text-text-secondary">{props.skill.description}</p>
      <div class="flex items-center justify-between gap-2 mt-1">
        <code class="text-xs text-text-tertiary font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
          {props.skill.id}
        </code>
        <Show when={props.skill.agentId}>
          <span class="flex items-center gap-1 text-xs text-text-tertiary">
            <Bot class="w-3 h-3" />
            {props.skill.agentId}
          </span>
        </Show>
      </div>
    </div>
  );
}

type SkillGroup = {
  title: string;
  description: string;
  skills: SkillInfo[];
};

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

  const groups = createMemo((): SkillGroup[] => {
    const all = skills();
    const preinstalled = all.filter((s) => s.source === 'preinstalled');
    const modified = all.filter((s) => s.source === 'modified');
    const userGlobal = all.filter((s) => s.source === 'user-global');
    const agent = all.filter((s) => s.source === 'agent');
    const unknown = all.filter((s) => !s.source);

    const result: SkillGroup[] = [];
    if (preinstalled.length > 0) {
      result.push({
        title: 'Pre-installed',
        description: 'Bundled skills shipped with OpenAidy',
        skills: preinstalled,
      });
    }
    if (modified.length > 0) {
      result.push({
        title: 'Modified',
        description: 'Pre-installed skills you have customized',
        skills: modified,
      });
    }
    if (userGlobal.length > 0) {
      result.push({
        title: 'Custom',
        description: 'Skills you created globally',
        skills: userGlobal,
      });
    }
    if (agent.length > 0) {
      result.push({
        title: 'Agent Skills',
        description: 'Skills created by agents in their own workspace',
        skills: agent,
      });
    }
    if (unknown.length > 0) {
      result.push({
        title: 'Other',
        description: '',
        skills: unknown,
      });
    }
    return result;
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

      {/* Grouped skills */}
      <Show when={!isLoading() && !error() && skills().length > 0}>
        <div class="space-y-8">
          <For each={groups()}>
            {(group) => (
              <section>
                <div class="mb-3">
                  <h2 class="text-sm font-semibold text-text-primary">
                    {group.title}
                  </h2>
                  <Show when={group.description}>
                    <p class="text-xs text-text-tertiary mt-0.5">
                      {group.description}
                    </p>
                  </Show>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <For each={group.skills}>
                    {(skill) => <SkillCard skill={skill} />}
                  </For>
                </div>
              </section>
            )}
          </For>
        </div>
      </Show>
    </Layout>
  );
}
