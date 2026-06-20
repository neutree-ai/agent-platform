import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import preact from '@astrojs/preact'

export default defineConfig({
  site: 'https://nap.docs.neutree.ai',
  integrations: [
    preact(),
    starlight({
      title: 'Neutree Agent Platform Docs',
      favicon: '/favicon.svg',
      customCss: ['./src/styles/print.css'],
      components: {
        Head: './src/components/Head.astro',
        TableOfContents: './src/components/TocWithActions.astro',
      },
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en-US' },
      },
      sidebar: [
        {
          label: 'Concepts',
          items: [
            { label: 'Overview', slug: 'concepts/overview' },
            { label: 'Agents & Workspaces', slug: 'concepts/agent-and-workspace' },
            { label: 'Agent Anatomy', slug: 'concepts/agent-anatomy' },
            { label: 'Triggers & Routes', slug: 'concepts/triggers-and-routes' },
            { label: 'Agent File Sharing (AFS)', slug: 'concepts/afs' },
            { label: 'Teamwork', slug: 'concepts/teamwork' },
            { label: 'Memory Store', slug: 'concepts/memory-store' },
            { label: 'Builder Mode', slug: 'concepts/builder-mode' },
            { label: 'Optimization', slug: 'concepts/optimize' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: '1. Setup', slug: 'guides/1-setup' },
            {
              label: 'Build',
              items: [
                { label: '2. Your First Agent', slug: 'guides/2-first-agent' },
                { label: '3. Agent Behavior', slug: 'guides/3-agent-behavior' },
                { label: '4. Extend the Workspace', slug: 'guides/4-extend-workspace' },
              ],
            },
            {
              label: 'Distribute',
              items: [
                { label: '5. Trigger Agents', slug: 'guides/5-trigger-agents' },
                { label: '6. Compose Agents', slug: 'guides/6-compose-agents' },
                { label: '7. Operate at Scale', slug: 'guides/7-operate-at-scale' },
              ],
            },
          ],
        },
        {
          label: 'Use Cases',
          items: [{ label: 'Translation', slug: 'use-cases/translation' }],
        },
        {
          label: 'Self-Host',
          items: [
            { label: 'Deployment Guide', slug: 'self-host' },
            { label: 'Single-Node (k3s) Quickstart', slug: 'self-host/single-node' },
            { label: 'Ingress', slug: 'self-host/ingress' },
            { label: 'LDAP', slug: 'self-host/ldap' },
            { label: 'Sandbox & Browser', slug: 'self-host/sandbox-browser' },
          ],
        },
        {
          label: 'API Docs',
          link: 'https://nap.neutree.ai/api/docs',
          attrs: { target: '_blank', rel: 'noopener' },
        },
      ],
    }),
  ],
})
