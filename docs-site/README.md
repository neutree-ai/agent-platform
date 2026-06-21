# Docs Site

Bilingual (English + Simplified Chinese) documentation site for Neutree Agent
Platform, built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

```bash
npm install
npm run dev      # local preview
npm run build    # static build → dist/
```

Content lives in `src/content/docs/`. English is the default locale (served at
the root); Simplified Chinese lives under `src/content/docs/zh-cn/`.

## Extension point: Use Cases

This repo ships **no** use-case pages — the "Use Cases" section is an extension
point for downstream distributions to add deployment-specific scenarios without
forking the site.

To add use cases, drop `.md` / `.mdx` files into the default-locale directory
before building:

```
src/content/docs/use-cases/<scenario>.md
```

The sidebar "Use Cases" group then appears automatically and auto-generates its
entries from the pages' frontmatter titles (it stays hidden when the directory
is empty — see `astro.config.mjs`). Page titles drive the sidebar labels, so
author them in whatever language the scenario targets; pages without a `zh-cn/`
counterpart render the same content on both locales.

A downstream build typically overlays its use-case files into the build context
at deploy time, keeping this repo's tree untouched.
