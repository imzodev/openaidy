import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { Lightbulb, Bot, AlertTriangle } from 'lucide-solid';
import { Layout } from './Layout';
import {
  listSkills,
  type SkillInfo,
  type SkillLoadError,
  type SkillSource,
} from '../../lib/api';
import {
  SKILL_SOURCE_BADGE,
  SKILL_SOURCE_BADGE_CLASSES,
  SKILL_SOURCE_LABEL,
} from '../../lib/skill-sources';

function SourceBadge(props: { source: SkillSource }) {
  const variant = () => SKILL_SOURCE_BADGE[props.source];
  return (
    <span
      class={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${SKILL_SOURCE_BADGE_CLASSES[variant()]}`}
    >
      {SKILL_SOURCE_LABEL[props.source]}
    </span>
  );
}

function SkillCard(props: { skill: SkillInfo }) {
  return (
    <div class="bg-white dark:bg-gray-800 rounded border border-border px-3 py-2 flex flex-col gap-0.5">
      <div class="flex items-center gap-2">
        <Lightbulb class="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span class="font-medium text-sm text-text-primary truncate flex-1">
          {props.skill.name}
        </span>
        <code class="text-xs text-text-tertiary font-mono bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded flex-shrink-0">
          {props.skill.id}
        </code>
        <Show when={props.skill.agentId}>
          <span class="flex items-center gap-0.5 text-xs text-text-tertiary flex-shrink-0">
            <Bot class="w-3 h-3" />
            {props.skill.agentId}
          </span>
        </Show>
        <Show when={props.skill.source}>
          <SourceBadge source={props.skill.source!} />
        </Show>
      </div>
      <p
        class="text-xs text-text-tertiary truncate pl-5"
        title={props.skill.description}
      >
        {props.skill.description}
      </p>
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
  const [loadErrors, setLoadErrors] = createSignal<SkillLoadError[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listSkills();
      setSkills(data.items);
      setLoadErrors(data.loadErrors);
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

      {/* Load errors: SKILL.md files the registry refused. These exist on
          disk but are NOT in `items` — without this banner, an operator has
          no way to see why a skill listed in the agent config does nothing. */}
      <Show when={!isLoading() && loadErrors().length > 0}>
        <section class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
          <header class="flex items-center gap-2 mb-2">
            <AlertTriangle class="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <h2 class="text-sm font-semibold text-amber-900 dark:text-amber-300">
              {loadErrors().length} skill
              {loadErrors().length === 1 ? '' : 's'} failed to load
            </h2>
          </header>
          <p class="text-xs text-amber-800 dark:text-amber-400 mb-3">
            These SKILL.md files exist on disk but the registry rejected them.
            Most often this is missing or malformed YAML frontmatter — the file
            must start with{' '}
            <code class="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">
              ---
            </code>{' '}
            and include at minimum{' '}
            <code class="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">
              name
            </code>{' '}
            and{' '}
            <code class="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">
              description
            </code>
            . Use the{' '}
            <code class="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">
              skill_create
            </code>{' '}
            tool to write a valid one.
          </p>
          <ul class="flex flex-col gap-1.5">
            <For each={loadErrors()}>
              {(err) => (
                <li class="bg-white/60 dark:bg-black/20 border border-amber-200/60 dark:border-amber-800/40 rounded px-3 py-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <code class="text-xs font-mono font-semibold text-amber-900 dark:text-amber-300">
                      {err.id}
                    </code>
                    <Show when={err.agentId}>
                      <span class="flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-400">
                        <Bot class="w-3 h-3" />
                        <code class="font-mono">{err.agentId}</code>
                        <span class="text-amber-700/60 dark:text-amber-400/60">
                          (workspace)
                        </span>
                      </span>
                    </Show>
                  </div>
                  <ul class="text-xs text-amber-800 dark:text-amber-400 list-disc pl-5 mt-1">
                    <For each={err.messages}>{(msg) => <li>{msg}</li>}</For>
                  </ul>
                </li>
              )}
            </For>
          </ul>
        </section>
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
        <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
          <For each={groups()}>
            {(group) => (
              <section>
                <div class="px-4 py-2 bg-gray-50 dark:bg-gray-900/50 flex items-center gap-2">
                  <h2 class="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    {group.title}
                  </h2>
                  <span class="text-xs text-text-tertiary bg-gray-200 dark:bg-gray-700 rounded-full px-1.5 py-0.5 font-mono leading-none">
                    {group.skills.length}
                  </span>
                </div>
                <div class="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
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
