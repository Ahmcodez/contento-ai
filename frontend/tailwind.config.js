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
        // --- Redesign-phase palette (Vmaker-inspired) ---
        // Lives alongside the tokens above rather than replacing them:
        // sections get migrated over one at a time, so both systems are
        // in play during the transition. Distinct names on purpose, even
        // where a value is close to an existing token (e.g. graphite vs.
        // ink) — keeps each phase's intent unambiguous in the markup.
        frost: {
          50: '#F8FAFC',
          100: '#EDF5FF',
        },
        graphite: '#0F172A',
        steel: '#64748B',
        mist: '#E2E8F0',
        accent: {
          cyan: '#38BDF8',
          violet: '#A855F7',
          magenta: '#EC4899',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Public Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        // Geometric sans, used only where copy sits directly over a photo/
        // illustration (currently just the hero) — the serif display face
        // reads too soft against imagery and wants a sturdier, more
        // structural letterform there instead.
        geo: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        // Redesign-phase headline/body face.
        jakarta: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
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
        // Redesign-phase: soft glow under the gradient pill CTA.
        'pill-glow': '0 8px 30px -6px rgba(168, 85, 247, 0.45)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(90deg, #A855F7 0%, #EC4899 50%, #38BDF8 100%)',
      },
    },
  },
  plugins: [],
};
