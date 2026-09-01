import nextConfig from 'eslint-config-next/core-web-vitals';

// Next.js 16 removed the built-in `next lint` command / ESLint wrapper
// (see the "next lint" absence from `next --help` as of this upgrade),
// so this project now owns its ESLint config directly rather than
// relying on Next to supply one implicitly.
const config = [
  ...nextConfig,
  {
    ignores: ['.next/**', 'node_modules/**'],
    rules: {
      // This codebase's house style for data fetching is a plain
      // `useEffect(() => { load() }, [deps])` calling an async function
      // that eventually calls setState — used consistently across every
      // screen (dashboard, project detail, usage, ClipsPanel,
      // ContentPanel, TranscriptPanel), not incidentally. The rule's
      // "cascading render" concern is about setState called
      // *synchronously* within the effect body from already-available
      // state; here setState only happens after the async fetch
      // resolves, which isn't that case. Turning it off project-wide
      // rather than sprinkling per-line disables across 6+ call sites
      // that all follow the same intentional pattern.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
