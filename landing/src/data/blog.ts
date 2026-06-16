export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  author: string;
  authorRole: string;
  date: string;
  readTime: string;
  category: string;
  coverGradient: string;
  content: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'introducing-openaidy',
    title: 'Introducing OpenAidy: Open Source AI Agents for Everyone',
    description:
      'Today we are launching OpenAidy — a fully open source, self-hosted AI agent platform. Install in minutes, own everything forever. Here is why we built it and what you can do with it.',
    author: 'OpenAidy Team',
    authorRole: 'Core Team',
    date: '2026-06-10',
    readTime: '4 min',
    category: 'Announcement',
    coverGradient:
      'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
    content: `
<p>We are thrilled to announce the public launch of OpenAidy — a fully open source, self-hosted AI agent platform built for developers who want power, flexibility, and ownership.</p>
<h2>Why OpenAidy?</h2>
<p>Every week a new AI product launches and locks you into its platform, its pricing model, and its roadmap. We believe developers deserve better. OpenAidy gives you a production-ready agent runtime that you install on your own infrastructure, extend with your own plugins, and control completely.</p>
<h2>Core Features</h2>
<ul>
  <li><strong>Plugin system</strong> — Build agents that work with your tools, your APIs, your data.</li>
  <li><strong>Multi-channel</strong> — Deploy agents on WhatsApp, Slack, Telegram, and more.</li>
  <li><strong>Scheduler</strong> — Set it and forget it. Cron jobs, webhooks, one-shot tasks.</li>
  <li><strong>Session memory</strong> — Agents that remember context across conversations.</li>
  <li><strong>Provider agnostic</strong> — Bring your own API keys. OpenAI, Anthropic, Ollama, anything.</li>
</ul>
<h2>Get Started</h2>
<p>Head to the <a href="/docs">docs</a> to set up your first agent in under five minutes. The platform runs anywhere Node.js runs — a VPS, your laptop, a Kubernetes cluster, a Raspberry Pi.</p>
<p>Star the repo, join the community, and let us know what you build.</p>`,
  },
  {
    slug: 'whatsapp-channel-deep-dive',
    title: 'Connecting WhatsApp to Your AI Agent: A Complete Walkthrough',
    description:
      'A step-by-step guide to setting up the WhatsApp channel in OpenAidy — from zero to your agent responding to real messages.',
    author: 'OpenAidy Team',
    authorRole: 'Developer Experience',
    date: '2026-06-12',
    readTime: '8 min',
    category: 'Tutorial',
    coverGradient:
      'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
    content: `
<p>WhatsApp is where a huge portion of the world communicates. Connecting it to your OpenAidy agent means your users can message an AI agent using a tool they already use every day.</p>
<h2>Prerequisites</h2>
<p>You will need a WhatsApp Business account linked to a phone number. This guide uses the official WhatsApp Business API via the OpenAidy channel plugin.</p>
<h2>Step 1: Obtain Your WhatsApp Business API Credentials</h2>
<p>Sign up at the Meta Business developer portal and create a WhatsApp Business app. Copy your Phone Number ID, WhatsApp Business Account ID, and generate a permanent access token.</p>
<h2>Step 2: Configure the Channel in OpenAidy</h2>
<p>In your OpenAidy config, add the WhatsApp channel with your credentials. Restart the agent — you will see the WhatsApp channel listed as active.</p>
<h2>Step 3: Link Your Phone Number</h2>
<p>OpenAidy provides a QR code for linking when running in development mode. In production, use the webhook URL provided to receive incoming messages.</p>
<h2>What is Next?</h2>
<p>Once connected, you can <a href="/docs/user/scheduler">schedule agent tasks</a> or connect additional <a href="/docs/channels">channels</a> to the same agent. One agent, everywhere.</p>`,
  },
  {
    slug: 'hermes-agent-integration',
    title: 'How OpenAidy Uses Hermes Agent for Task Orchestration',
    description:
      'Behind the scenes: how the Hermes Agent plugin registry and task orchestration system powers OpenAidy most advanced agent behaviors.',
    author: 'OpenAidy Team',
    authorRole: 'Architecture',
    date: '2026-06-14',
    readTime: '6 min',
    category: 'Deep Dive',
    coverGradient:
      'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
    content: `
<p>OpenAidy is built on top of Hermes Agent — a plugin-based provider registry that lets you swap LLM backends, add custom tools, and orchestrate multi-step tasks with a clean declarative API.</p>
<h2>The ProviderRegistry Pattern</h2>
<p>Instead of hardcoding an LLM provider, OpenAidy uses a ProviderProfile dataclass with hooks for pre-processing, inference, and post-processing. You can register any provider that implements the interface — OpenAI, Anthropic, a local Ollama instance, or a custom endpoint.</p>
<h2>Delegation and Subagents</h2>
<p>Complex tasks are decomposed into sub-tasks that run in isolated agent contexts. The orchestrator manages lifecycle, passes context between tasks, and aggregates results. This is how OpenAidy handles things like research tasks that require multiple web searches and synthesis steps.</p>
<h2>Plugins as First-Class Citizens</h2>
<p>Plugins in Hermes Agent expose a Tool interface that agents call natively. OpenAidy bundles plugins for scheduling, channels, and memory — and you can build your own in minutes.</p>
<h2>What This Means for OpenAidy Users</h2>
<p>You get enterprise-grade task orchestration without vendor lock-in. The agent adapts to your infrastructure and your tools — not the other way around.</p>`,
  },
  {
    slug: 'building-first-plugin',
    title: 'Building Your First OpenAidy Plugin in 10 Minutes',
    description:
      'A practical guide to writing a custom OpenAidy plugin — from scaffolding to deployment — using the Plugin interface.',
    author: 'OpenAidy Team',
    authorRole: 'Developer Experience',
    date: '2026-06-15',
    readTime: '10 min',
    category: 'Tutorial',
    coverGradient:
      'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 50%, #1e40af 100%)',
    content: `
<p>OpenAidy plugin system is one of its most powerful features. If OpenAidy does not do something you need out of the box, you can add it with a plugin. This guide walks through building a plugin that fetches live crypto prices.</p>
<h2>What is a Plugin?</h2>
<p>A plugin is a Python package that registers one or more Tool functions with the OpenAidy runtime. When an agent needs to use a tool, OpenAidy dispatches to your plugin function and returns the result to the agent.</p>
<h2>Scaffold the Plugin</h2>
<p>Use the OpenAidy CLI to scaffold a new plugin: openaidy plugin init crypto-prices. This creates the directory structure, the Python package files, and the plugin manifest.</p>
<h2>Implement the Tool Function</h2>
<p>Add a function that calls a crypto price API. Decorate it with the openaidy.tool decorator to register it. Write a clear description — this is what the agent uses to decide when to call the tool.</p>
<h2>Register and Deploy</h2>
<p>Add the plugin to your openaidy.yaml config and restart. The agent will now include the crypto prices tool in its available actions.</p>`,
  },
  {
    slug: 'roadmap-q2-2026',
    title: 'What is Coming in OpenAidy Q3 2026',
    description:
      'A look at what the team is working on next — including voice agents, a visual workflow builder, and native MCP server support.',
    author: 'OpenAidy Team',
    authorRole: 'Product',
    date: '2026-06-16',
    readTime: '5 min',
    category: 'Roadmap',
    coverGradient:
      'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #5b21b6 100%)',
    content: `
<p>We have had an incredible few months since launch. Here is a look at what is coming in the next quarter.</p>
<h2>Voice Agents</h2>
<p>You will soon be able to run agents that speak. Voice input and output using WebRTC, ElevenLabs for synthesis, and Whisper for transcription. Deploy a voice agent to WhatsApp or the web in minutes.</p>
<h2>Visual Workflow Builder</h2>
<p>A drag-and-drop canvas for composing multi-step agent workflows. No code required for common patterns — chain tools, conditions, and loops visually. Export to code when you need custom logic.</p>
<h2>Native MCP Server Support</h2>
<p>Model Context Protocol support so OpenAidy agents can connect directly to any MCP server. If an MCP server has a tool, OpenAidy can use it without writing a plugin.</p>
<h2>Multi-Agent Orchestration</h2>
<p>Run multiple agents that collaborate on a single task. Define roles, shared memory, and handoff rules. Think of it as a team of specialists working together.</p>
<h2>Open Source forever</h2>
<p>Everything above will be released under the same MIT license as the rest of OpenAidy. No open core, no bait-and-switch. We build in public on GitHub.</p>`,
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
