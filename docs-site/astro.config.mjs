import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import preact from '@astrojs/preact'

// "Use Cases" is an extension point: this repo ships none. A downstream
// distribution adds deployment-specific scenarios by dropping .md/.mdx files
// into src/content/docs/use-cases/ (default locale) before building. The
// section auto-appears (and auto-generates its entries) only when files exist,
// so the upstream build shows no empty "Use Cases" group.
const useCasesDir = fileURLToPath(new URL('./src/content/docs/use-cases/', import.meta.url))
const hasUseCases =
  existsSync(useCasesDir) && readdirSync(useCasesDir).some((f) => /\.mdx?$/.test(f))

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
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      sidebar: [
        {
          label: 'Concepts',
          translations: { 'zh-CN': '概念' },
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'concepts/overview' },
            {
              label: 'Agents & Workspaces',
              translations: { 'zh-CN': 'Agent 与 Workspace' },
              slug: 'concepts/agent-and-workspace',
            },
            {
              label: 'Agent Anatomy',
              translations: { 'zh-CN': 'Agent 的组成' },
              slug: 'concepts/agent-anatomy',
            },
            {
              label: 'Triggers & Routes',
              translations: { 'zh-CN': '触发与路由' },
              slug: 'concepts/triggers-and-routes',
            },
            {
              label: 'Agent File Sharing (AFS)',
              translations: { 'zh-CN': '跨 Agent 文件共享（AFS）' },
              slug: 'concepts/afs',
            },
            { label: 'Teamwork', translations: { 'zh-CN': 'Teamwork' }, slug: 'concepts/teamwork' },
            {
              label: 'Memory Store',
              translations: { 'zh-CN': '记忆库（Memory Store）' },
              slug: 'concepts/memory-store',
            },
            {
              label: 'Builder Mode',
              translations: { 'zh-CN': 'Builder Mode' },
              slug: 'concepts/builder-mode',
            },
            { label: 'Optimization', translations: { 'zh-CN': '优化' }, slug: 'concepts/optimize' },
          ],
        },
        {
          label: 'Guides',
          translations: { 'zh-CN': '指南' },
          items: [
            { label: '1. Setup', translations: { 'zh-CN': '1. 准备工作' }, slug: 'guides/1-setup' },
            {
              label: 'Build',
              translations: { 'zh-CN': '构建' },
              items: [
                {
                  label: '2. Your First Agent',
                  translations: { 'zh-CN': '2. 第一个 Agent' },
                  slug: 'guides/2-first-agent',
                },
                {
                  label: '3. Agent Behavior',
                  translations: { 'zh-CN': '3. 定义 Agent 行为' },
                  slug: 'guides/3-agent-behavior',
                },
                {
                  label: '4. Extend the Workspace',
                  translations: { 'zh-CN': '4. 扩展 Workspace' },
                  slug: 'guides/4-extend-workspace',
                },
              ],
            },
            {
              label: 'Distribute',
              translations: { 'zh-CN': '分发' },
              items: [
                {
                  label: '5. Trigger Agents',
                  translations: { 'zh-CN': '5. 触发 Agent' },
                  slug: 'guides/5-trigger-agents',
                },
                {
                  label: '6. Compose Agents',
                  translations: { 'zh-CN': '6. 多 Agent 协作' },
                  slug: 'guides/6-compose-agents',
                },
                {
                  label: '7. Operate at Scale',
                  translations: { 'zh-CN': '7. 规模化运营' },
                  slug: 'guides/7-operate-at-scale',
                },
              ],
            },
          ],
        },
        ...(hasUseCases
          ? [
              {
                label: 'Use Cases',
                translations: { 'zh-CN': '场景' },
                autogenerate: { directory: 'use-cases' },
              },
            ]
          : []),
        {
          label: 'Self-Host',
          translations: { 'zh-CN': '自部署' },
          items: [
            {
              label: 'Deployment Guide',
              translations: { 'zh-CN': '部署指南' },
              slug: 'self-host',
            },
            {
              label: 'Single-Node (k3s) Quickstart',
              translations: { 'zh-CN': '单节点 k3s 快速部署' },
              slug: 'self-host/single-node',
            },
            { label: 'Ingress', translations: { 'zh-CN': 'Ingress 接入' }, slug: 'self-host/ingress' },
            { label: 'LDAP', translations: { 'zh-CN': 'LDAP 接入' }, slug: 'self-host/ldap' },
            {
              label: 'Sandbox & Browser',
              translations: { 'zh-CN': '代码沙箱 / 远端浏览器' },
              slug: 'self-host/sandbox-browser',
            },
          ],
        },
        {
          label: 'API Docs',
          translations: { 'zh-CN': 'API 文档' },
          link: 'https://nap.neutree.ai/api/docs',
          attrs: { target: '_blank', rel: 'noopener' },
        },
      ],
    }),
  ],
})
