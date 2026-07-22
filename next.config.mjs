import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

initOpenNextCloudflareForDev();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow browser tests to run beside an existing developer server without
  // sharing Next's build cache or dev-server lock. Production keeps `.next`.
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
  // Keep the local UI preview visually identical to production. Compile and
  // runtime errors still surface through Next.js without the floating badge.
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
