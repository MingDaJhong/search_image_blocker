/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './entrypoints/**/*.{vue,ts,html}',
    './components/**/*.{vue,ts}',
    './composables/**/*.ts',
  ],
  // 改用 'class' 模式 — 透過在 <html> 加 .dark class 控制，配合 popup 的 toggle。
  // 初始 class 會根據 settings.theme（首次無設定時 fallback 到 OS prefers-color-scheme）決定。
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
    },
  },
  plugins: [],
}
