import { createSignal, onMount } from 'solid-js';
import {
  Bot,
  Zap,
  Link,
  Wrench,
  Server,
  Layers,
  CheckSquare,
  Plus,
  ArrowRight,
} from 'lucide-solid';
import type { ViewType } from '../Sidebar';

type HomePageProps = {
  onNavigate: (view: ViewType) => void;
  onCreateSession: () => void;
};

const features = [
  {
    icon: Bot,
    color: 'blue',
    title: 'AI Agents',
    description:
      'Persistent, streaming AI assistants with custom personalities, tools, and skills.',
    view: 'agents' as ViewType,
  },
  {
    icon: Layers,
    color: 'green',
    title: 'Sessions',
    description:
      'Conversational memory across time — pick up where you left off, with full context.',
    view: 'sessions' as ViewType,
  },
  {
    icon: CheckSquare,
    color: 'emerald',
    title: 'Tasks & Automations',
    description:
      'Schedule agent work with cron jobs and one-shot triggers — runs happen while you sleep.',
    view: 'tasks' as ViewType,
  },
  {
    icon: Link,
    color: 'cyan',
    title: 'Channels',
    description:
      'Connect to WhatsApp, Telegram, Discord, and more — bring agents where your users are.',
    view: 'channels' as ViewType,
  },
  {
    icon: Wrench,
    color: 'violet',
    title: 'Skills',
    description:
      'Reusable system-prompt templates attachable to any agent — compose capability, not code.',
    view: 'skills' as ViewType,
  },
  {
    icon: Server,
    color: 'purple',
    title: 'MCP Servers',
    description:
      'Connect to any MCP server via stdio or HTTP — extend platform and agent capabilities.',
    view: 'mcps' as ViewType,
  },
];

const colorMap: Record<
  string,
  { bg: string; icon: string; border: string; shadow: string; dot: string }
> = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    icon: 'text-blue-600 dark:text-blue-400',
    border: 'hover:border-blue-300 dark:hover:border-blue-600',
    shadow: 'hover:shadow-blue-500/10',
    dot: 'bg-blue-400',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    icon: 'text-green-600 dark:text-green-400',
    border: 'hover:border-green-300 dark:hover:border-green-600',
    shadow: 'hover:shadow-green-500/10',
    dot: 'bg-green-400',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    icon: 'text-emerald-600 dark:text-emerald-400',
    border: 'hover:border-emerald-300 dark:hover:border-emerald-600',
    shadow: 'hover:shadow-emerald-500/10',
    dot: 'bg-emerald-400',
  },
  cyan: {
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    icon: 'text-cyan-600 dark:text-cyan-400',
    border: 'hover:border-cyan-300 dark:hover:border-cyan-600',
    shadow: 'hover:shadow-cyan-500/10',
    dot: 'bg-cyan-400',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-900/20',
    icon: 'text-violet-600 dark:text-violet-400',
    border: 'hover:border-violet-300 dark:hover:border-violet-600',
    shadow: 'hover:shadow-violet-500/10',
    dot: 'bg-violet-400',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    icon: 'text-purple-600 dark:text-purple-400',
    border: 'hover:border-purple-300 dark:hover:border-purple-600',
    shadow: 'hover:shadow-purple-500/10',
    dot: 'bg-purple-400',
  },
};

export function HomePage(props: HomePageProps) {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    // Stagger entrance animation
    requestAnimationFrame(() => setVisible(true));
  });

  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="w-full max-w-6xl mx-auto px-4 sm:px-6 py-10">
        {/* ── Hero ── */}
        <div
          class={`text-center mb-12 transition-all duration-700 ${visible() ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
        >
          {/* Banner */}
          <div class="relative rounded-2xl overflow-hidden shadow-xl mb-8 border border-gray-200 dark:border-gray-700 group">
            <img
              src="../../docs/assets/banner.png"
              alt="OpenAidy"
              class="w-full object-cover group-hover:scale-105 transition-transform duration-700"
              style="max-height: 320px;"
            />
            <div class="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />
          </div>

          {/* Badge */}
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium mb-5">
            <Zap class="w-3.5 h-3.5" />
            OpenAI DIY
          </div>

          <h1 class="text-4xl sm:text-5xl font-bold text-text-primary mb-4 tracking-tight">
            Build, run, and extend
            <br class="hidden sm:block" /> AI agents
          </h1>
          <p class="text-text-secondary text-lg sm:text-xl max-w-2xl mx-auto mb-8 leading-relaxed">
            A plugin-first AI operations platform — persistent sessions,
            real-time streaming, channels, automations, and MCP integration.
            Open source and self-hosted.
          </p>

          {/* CTA row */}
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={props.onCreateSession}
              class="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-hover shadow-md hover:shadow-lg hover:shadow-blue-500/20 transition-all duration-200 active:scale-95"
            >
              <Plus class="w-4 h-4" />
              Start chatting
              <ArrowRight class="w-4 h-4" />
            </button>
            <button
              onClick={() => props.onNavigate('agents')}
              class="inline-flex items-center gap-2 px-6 py-3.5 text-sm font-medium text-text-secondary bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
            >
              Explore agents
            </button>
          </div>
        </div>

        {/* ── Feature Grid ── */}
        <div class="mb-10">
          <div class="flex items-center justify-center gap-4 mb-6">
            <div class="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />
            <span class="text-xs font-medium text-text-muted uppercase tracking-widest">
              Platform capabilities
            </span>
            <div class="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feature, i) => {
              const c = colorMap[feature.color];
              return (
                <button
                  onClick={() => props.onNavigate(feature.view)}
                  class={`group relative text-left bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 ${c.border} ${c.shadow} hover:shadow-lg transition-all duration-200 cursor-pointer`}
                  style={`animation-delay: ${i * 80}ms`}
                >
                  {/* Icon */}
                  <div
                    class={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200`}
                  >
                    <feature.icon class={`w-5 h-5 ${c.icon}`} />
                  </div>

                  <h3 class="text-base font-semibold text-text-primary mb-2">
                    {feature.title}
                  </h3>
                  <p class="text-sm text-text-secondary leading-relaxed">
                    {feature.description}
                  </p>

                  {/* Arrow indicator */}
                  <div class="absolute top-5 right-5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <ArrowRight class={`w-4 h-4 ${c.icon}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Getting started strip ── */}
        <div class="flex items-center justify-center gap-4 mb-6">
          <div class="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />
          <div class="flex items-center gap-3 text-xs text-text-muted">
            <div class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span>Ready to go — self-hosted, no cloud required</span>
          </div>
          <div class="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />
        </div>
      </div>
    </div>
  );
}
