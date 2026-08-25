/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#14161C',
        paper: '#F6F4EF',
        slate: {
          DEFAULT: '#8A8D97',
          dim: '#5B5E68',
        },
        line: {
          dark: '#2A2D35',
          light: '#E4E1D9',
        },
        tally: {
          DEFAULT: '#B3402F',
          hover: '#9A3527',
          dim: '#B3402F1A',
        },
        surface: {
          dark: '#1B1D24',
          darkRaised: '#22252D',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Public Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
    },
  },
  plugins: [],
};
