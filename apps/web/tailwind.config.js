/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';

const scrollbarNone = plugin(({ addUtilities }) => {
  addUtilities({
    '.scrollbar-none': {
      '-ms-overflow-style': 'none',
      'scrollbar-width': 'none',
      '&::-webkit-scrollbar': { display: 'none' },
    },
  });
});

// Palettes follow Apple's system colors (HIG). The gray scale is deliberately
// dual-use: the same steps serve light-mode text (500–900) and dark-mode
// surfaces (700–950), so the ~2,300 existing `gray-*` / `dark:*-gray-*`
// classes pick up the new look without touching every component.
const gray = {
  50: '#f5f5f7',
  100: '#ededf0',
  200: '#e3e3e8',
  300: '#d1d1d6',
  400: '#aeaeb2',
  500: '#86868b',
  600: '#6e6e73',
  700: '#3a3a3c',
  800: '#2c2c2e',
  900: '#1c1c1e',
  950: '#111113',
};

const blue = {
  50: '#f0f7ff',
  100: '#e0eeff',
  200: '#bddbff',
  300: '#8ac0ff',
  400: '#4da2ff',
  500: '#0a84ff',
  600: '#007aff',
  700: '#0066d6',
  800: '#0051ab',
  900: '#003d80',
  950: '#002855',
};

const red = {
  50: '#fff2f1',
  100: '#ffe3e1',
  200: '#ffc7c3',
  300: '#ff9f98',
  400: '#ff6961',
  500: '#ff453a',
  600: '#e8372c',
  700: '#c4211a',
  800: '#9e1a14',
  900: '#7a1611',
  950: '#430806',
};

const green = {
  50: '#eefbf1',
  100: '#d7f5df',
  200: '#aeebbf',
  300: '#7adb97',
  400: '#30d158',
  500: '#34c759',
  600: '#248a3d',
  700: '#1e7334',
  800: '#1a5c2b',
  900: '#154a24',
  950: '#0a2913',
};

const amber = {
  50: '#fff8eb',
  100: '#ffedcc',
  200: '#ffda99',
  300: '#ffc266',
  400: '#ffb340',
  500: '#ff9f0a',
  600: '#c77700',
  700: '#9e5f00',
  800: '#7a4900',
  900: '#5c3700',
  950: '#331f00',
};

const purple = {
  50: '#f9f0fd',
  100: '#f2dffb',
  200: '#e4bff6',
  300: '#d193ef',
  400: '#bf5af2',
  500: '#af52de',
  600: '#9a3dc9',
  700: '#7f2fa8',
  800: '#652586',
  900: '#4d1c66',
  950: '#2e103d',
};

const indigo = {
  50: '#f1f1fd',
  100: '#e1e1fb',
  200: '#c4c3f6',
  300: '#9f9df0',
  400: '#7d7aeb',
  500: '#5e5ce6',
  600: '#5856d6',
  700: '#4644b3',
  800: '#36358c',
  900: '#292866',
  950: '#18173d',
};

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gray,
        slate: gray,
        zinc: gray,
        neutral: gray,
        blue,
        red,
        green,
        amber,
        orange: amber,
        purple,
        violet: purple,
        indigo,
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-muted': 'var(--text-muted)',
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'bg-elevated': 'var(--bg-elevated)',
        'border-primary': 'var(--border-primary)',
        'border-secondary': 'var(--border-secondary)',
        primary: 'var(--primary)',
        'primary-hover': 'var(--primary-hover)',
        'primary-disabled': 'var(--primary-disabled)',
        separator: 'var(--separator)',
        fill: 'var(--fill)',
        'fill-strong': 'var(--fill-strong)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Inter Variable"',
          'Inter',
          '"Segoe UI Variable Text"',
          '"Segoe UI"',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          '"Cascadia Code"',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        sm: '0.375rem',
        DEFAULT: '0.5rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        sm: '0 1px 2px rgb(0 0 0 / 0.04), 0 0 0 0.5px rgb(0 0 0 / 0.04)',
        DEFAULT:
          '0 1px 3px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.04), 0 0 0 0.5px rgb(0 0 0 / 0.04)',
        md: '0 4px 12px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.05), 0 0 0 0.5px rgb(0 0 0 / 0.05)',
        lg: '0 10px 30px rgb(0 0 0 / 0.08), 0 2px 6px rgb(0 0 0 / 0.05), 0 0 0 0.5px rgb(0 0 0 / 0.05)',
        xl: '0 20px 50px rgb(0 0 0 / 0.12), 0 4px 12px rgb(0 0 0 / 0.06), 0 0 0 0.5px rgb(0 0 0 / 0.06)',
        '2xl':
          '0 32px 80px rgb(0 0 0 / 0.18), 0 8px 20px rgb(0 0 0 / 0.08), 0 0 0 0.5px rgb(0 0 0 / 0.08)',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        spring: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      keyframes: {
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'sheet-in': 'sheet-in 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'rise-in': 'rise-in 360ms cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [typography, scrollbarNone],
};
