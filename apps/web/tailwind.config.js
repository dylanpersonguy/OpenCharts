/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tv: {
          bg: '#131722',
          'bg-secondary': '#1e222d',
          panel: '#1e222d',
          'panel-hover': '#262b3d',
          border: '#2a2e39',
          'border-light': '#363a45',
          text: '#d1d4dc',
          'text-secondary': '#b2b5be',
          'text-muted': '#787b86',
          'text-active': '#ffffff',
          green: '#26a69a',
          'green-bg': 'rgba(38, 166, 154, 0.1)',
          red: '#ef5350',
          'red-bg': 'rgba(239, 83, 80, 0.1)',
          blue: '#2962ff',
          accent: '#2962ff',
          'accent-hover': '#1e53e5',
          'accent-bg': 'rgba(41, 98, 255, 0.1)',
          'toolbar-bg': '#1e222d',
          'toolbar-icon': '#787b86',
          'toolbar-icon-hover': '#d1d4dc',
          'toolbar-icon-active': '#2962ff',
          'row-hover': '#262b3d',
          'selected-row': '#2a2e39',
          overlay: 'rgba(19, 23, 34, 0.85)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Trebuchet MS', 'Roboto', 'Ubuntu', 'sans-serif'],
        mono: ['Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        '4.5': '1.125rem',
        '7': '1.75rem',
        '7.5': '1.875rem',
      },
    },
  },
  plugins: [],
};
