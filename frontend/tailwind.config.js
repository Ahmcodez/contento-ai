/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#0C0D11',
        paper: '#F8F6F1',
        slate: {
          DEFAULT: '#9A9DA7',
          dim: '#63666F',
        },
        line: {
          dark: '#282B33',
          light: '#E4E1D9',
        },
        // "tally" — the red indicator lamp on a broadcast camera that
        // lights up when it's live. The accent color and its glow
        // treatment are both named and used deliberately after this: not
        // decoration, the product's own visual vocabulary for "this is
        // live / this is the signal."
        tally: {
          DEFAULT: '#FF3B30',
          hover: '#E5291F',
          dim: '#FF3B301A',
        },
        surface: {
          dark: '#17191F',
          darkRaised: '#1E212A',
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
      boxShadow: {
        // The tally-light glow, in two intensities. Used sparingly — the
        // primary call-to-action and the one "live" indicator on the
        // hero — not smeared across every card or button.
        'glow-sm': '0 0 16px -4px rgba(255, 59, 48, 0.45)',
        glow: '0 0 34px -6px rgba(255, 59, 48, 0.6)',
      },
    },
  },
  plugins: [],
};
