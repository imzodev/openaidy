/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
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
      },
    },
  },
  plugins: [],
};
