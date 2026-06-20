import type { APIRoute, GetStaticPaths } from 'astro'

const rawMap = import.meta.glob('../../content/docs/**/*.{md,mdx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const getStaticPaths: GetStaticPaths = () =>
  Object.entries(rawMap).map(([p, content]) => {
    const slug = p.replace(/^.*\/content\/docs\//, '').replace(/\.(md|mdx)$/, '')
    return { params: { slug }, props: { content } }
  })

export const GET: APIRoute = ({ props }) =>
  new Response(props.content as string, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
