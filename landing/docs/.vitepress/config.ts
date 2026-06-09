import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'OpenAidy',
  description: 'Open Source AI Agent Platform — Documentation',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Docs', link: '/docs/' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Overview', link: '/docs/' },
          { text: 'Architecture', link: '/docs/architecture' },
          { text: 'Bootstrapping', link: '/docs/bootstrapping' },
        ],
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Data Model', link: '/docs/data-model' },
          { text: 'Control Plane', link: '/docs/control-plane' },
          { text: 'Channels', link: '/docs/channels' },
        ],
      },
      {
        text: 'Development',
        items: [
          { text: 'CLI', link: '/docs/cli' },
          { text: 'Plugin SDK', link: '/docs/plugin-sdk' },
          {
            text: 'Provider Adapter Plan',
            link: '/docs/provider-adapter-plan',
          },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/imzodev/openaidy' },
    ],
  },
});
