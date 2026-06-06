/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  safelist: [
    // Tremor charts construct color classes at runtime (e.g. fill-blue-500)
    // so Tailwind's content scanner can't detect them — safelist the colors we use.
    ...[
      'blue',
      'cyan',
      'emerald',
      'amber',
      'violet',
      'rose',
      'slate',
      'fuchsia',
      'lime',
      'teal',
    ].flatMap((color) =>
      [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((shade) => [
        `fill-${color}-${shade}`,
        `stroke-${color}-${shade}`,
        `bg-${color}-${shade}`,
        `text-${color}-${shade}`,
      ]),
    ),
  ],
  theme: {
    extend: {
      colors: {
        border: 'oklch(var(--border) / <alpha-value>)',
        input: 'oklch(var(--input) / <alpha-value>)',
        ring: 'oklch(var(--ring) / <alpha-value>)',
        background: 'oklch(var(--background) / <alpha-value>)',
        foreground: 'oklch(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'oklch(var(--primary) / <alpha-value>)',
          foreground: 'oklch(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'oklch(var(--secondary) / <alpha-value>)',
          foreground: 'oklch(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'oklch(var(--destructive) / <alpha-value>)',
          foreground: 'oklch(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'oklch(var(--muted) / <alpha-value>)',
          foreground: 'oklch(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'oklch(var(--accent) / <alpha-value>)',
          foreground: 'oklch(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'oklch(var(--popover) / <alpha-value>)',
          foreground: 'oklch(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'oklch(var(--card) / <alpha-value>)',
          foreground: 'oklch(var(--card-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'oklch(var(--success) / <alpha-value>)',
          foreground: 'oklch(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'oklch(var(--warning) / <alpha-value>)',
          foreground: 'oklch(var(--warning-foreground) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'oklch(var(--info) / <alpha-value>)',
          foreground: 'oklch(var(--info-foreground) / <alpha-value>)',
        },
        chart: {
          1: 'oklch(var(--chart-1) / <alpha-value>)',
          2: 'oklch(var(--chart-2) / <alpha-value>)',
          3: 'oklch(var(--chart-3) / <alpha-value>)',
          4: 'oklch(var(--chart-4) / <alpha-value>)',
          5: 'oklch(var(--chart-5) / <alpha-value>)',
          6: 'oklch(var(--chart-6) / <alpha-value>)',
          7: 'oklch(var(--chart-7) / <alpha-value>)',
          8: 'oklch(var(--chart-8) / <alpha-value>)',
          9: 'oklch(var(--chart-9) / <alpha-value>)',
        },
        tag: {
          slate: 'oklch(var(--tag-slate) / <alpha-value>)',
          rose: 'oklch(var(--tag-rose) / <alpha-value>)',
          amber: 'oklch(var(--tag-amber) / <alpha-value>)',
          emerald: 'oklch(var(--tag-emerald) / <alpha-value>)',
          sky: 'oklch(var(--tag-sky) / <alpha-value>)',
          violet: 'oklch(var(--tag-violet) / <alpha-value>)',
          orange: 'oklch(var(--tag-orange) / <alpha-value>)',
          pink: 'oklch(var(--tag-pink) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'oklch(var(--sidebar-background) / <alpha-value>)',
          foreground: 'oklch(var(--sidebar-foreground) / <alpha-value>)',
          primary: 'oklch(var(--sidebar-primary) / <alpha-value>)',
          'primary-foreground': 'oklch(var(--sidebar-primary-foreground) / <alpha-value>)',
          accent: 'oklch(var(--sidebar-accent) / <alpha-value>)',
          'accent-foreground': 'oklch(var(--sidebar-accent-foreground) / <alpha-value>)',
          border: 'oklch(var(--sidebar-border) / <alpha-value>)',
          ring: 'oklch(var(--sidebar-ring) / <alpha-value>)',
        },
      },
      keyframes: {
        'pulse-text': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'voice-eq': {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'breathing-halo': {
          '0%, 100%': { opacity: '0.4', transform: 'scale(0.95)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
      },
      animation: {
        'pulse-text': 'pulse-text 2s ease-in-out infinite',
        'voice-eq': 'voice-eq 1.1s ease-in-out infinite',
        'breathing-halo': 'breathing-halo 2.6s ease-in-out infinite',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        micro: ['9px', { lineHeight: '12px' }],
        mini: ['10px', { lineHeight: '14px' }],
        tiny: ['11px', { lineHeight: '15px' }],
      },
      fontFamily: {
        // Override Tailwind Preflight's default sans stack to insert CJK
        // fallbacks before `sans-serif`. Without these, Chrome/Edge
        // Print-to-PDF drops Chinese glyphs: the trailing emoji families
        // terminate the print font-fallback chain before it reaches the OS
        // CJK font (screen rendering uses a richer fallback path, so it only
        // shows up when saving/printing to PDF).
        sans: [
          'ui-sans-serif',
          'system-ui',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Noto Sans CJK SC"',
          '"Noto Sans SC"',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      typography: {
        sm: {
          css: {
            fontSize: '0.8125rem',
            lineHeight: '1.5',
            p: { marginTop: '0.25em', marginBottom: '0.25em' },
            '[class~="lead"]': { marginTop: '0.5em', marginBottom: '0.5em' },
            blockquote: {
              marginTop: '0.5em',
              marginBottom: '0.5em',
              paddingInlineStart: '0.75em',
              borderInlineStartWidth: '2px',
              fontStyle: 'normal',
              fontWeight: '400',
            },
            h1: { fontSize: '1.15em', marginTop: '0', marginBottom: '0.375em', fontWeight: '600' },
            h2: {
              fontSize: '1.05em',
              marginTop: '0.75em',
              marginBottom: '0.25em',
              fontWeight: '600',
            },
            h3: { fontSize: '1em', marginTop: '0.5em', marginBottom: '0.25em', fontWeight: '600' },
            h4: { marginTop: '0.5em', marginBottom: '0.125em', fontWeight: '600' },
            img: { marginTop: '0.5em', marginBottom: '0.5em' },
            picture: { marginTop: '0.5em', marginBottom: '0.5em' },
            video: { marginTop: '0.5em', marginBottom: '0.5em' },
            kbd: { fontSize: '0.8em', padding: '0.125em 0.25em' },
            code: { fontSize: '0.85em' },
            pre: {
              marginTop: '0.5em',
              marginBottom: '0.5em',
              padding: '0.5em 0.75em',
              borderRadius: '0.25rem',
            },
            ol: {
              marginTop: '0.25em',
              marginBottom: '0.25em',
              paddingInlineStart: '1.25em',
              listStyleType: 'decimal',
            },
            ul: {
              marginTop: '0.25em',
              marginBottom: '0.25em',
              paddingInlineStart: '1.25em',
              listStyleType: 'disc',
            },
            li: { marginTop: '0.05em', marginBottom: '0.05em' },
            'ol > li': { paddingInlineStart: '0.25em' },
            'ul > li': { paddingInlineStart: '0.25em' },
            '> ul > li p': { marginTop: '0', marginBottom: '0' },
            '> ol > li > *:first-child': { marginTop: '0' },
            '> ol > li > *:last-child': { marginBottom: '0' },
            'ul ul, ul ol, ol ul, ol ol': { marginTop: '0.125em', marginBottom: '0.125em' },
            'ul ul': { listStyleType: 'circle' },
            'ol ol': { listStyleType: 'lower-alpha' },
            dl: { marginTop: '0.5em', marginBottom: '0.5em' },
            hr: { marginTop: '0.75em', marginBottom: '0.75em' },
            table: { fontSize: '0.8em' },
            'thead th': {
              paddingInlineEnd: '0.5em',
              paddingBottom: '0.25em',
              paddingInlineStart: '0.5em',
            },
            'tbody td, tfoot td': {
              paddingTop: '0.25em',
              paddingInlineEnd: '0.5em',
              paddingBottom: '0.25em',
              paddingInlineStart: '0.5em',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
  ],
}
