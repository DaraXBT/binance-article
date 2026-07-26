import nextPlugin from 'eslint-config-next';

const config = [
  ...nextPlugin,
  {
    ignores: [
      '.agents/**',
      '.baoyu-skills/**',
      '.next/**',
      '.next-playwright/**',
      'coverage/**',
      'node_modules/**',
      'app/.well-known/**',
      'publisher-companion/**',
      'workers/article-workflow/cloudflare-runtime.d.ts',
      'workers/article-workflow/worker-configuration.d.ts',
    ],
  },
  {
    rules: {
      '@next/next/no-img-element': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
