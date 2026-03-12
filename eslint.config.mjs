import nextPlugin from 'eslint-config-next';

const config = [
  ...nextPlugin,
  {
    ignores: [
      '.agents/**',
      '.baoyu-skills/**',
      '.next/**',
      'coverage/**',
      'node_modules/**',
      'prisma/migrations/**',
      'app/.well-known/**',
      '**/*.test.ts',
      '**/*.test.tsx',
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
