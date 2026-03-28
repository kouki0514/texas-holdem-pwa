import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: {
          DEFAULT: '#1a472a',
          dark: '#0f2d16',
          light: '#2d6a4f',
        },
        chip: {
          white: '#f5f5f5',
          red: '#e63946',
          blue: '#457b9d',
          green: '#2a9d8f',
          black: '#1d1d1d',
        },
        card: {
          bg: '#fafafa',
          red: '#d62828',
          black: '#1d1d1d',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        card: '0 4px 8px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.6)',
        chip: '0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
      },
    },
  },
  plugins: [],
} satisfies Config
