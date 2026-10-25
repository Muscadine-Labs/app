import type { NextConfig } from "next";
import path from "path";

const x402Stub = path.join(process.cwd(), "src/lib/x402-stub.js");
const x402Alias = {
  "@x402/core$": x402Stub,
  "@x402/core/client": x402Stub,
  "@x402/evm$": x402Stub,
  "@x402/evm/exact/client": x402Stub,
  "@x402/evm/upto/client": x402Stub,
  "@x402/svm$": x402Stub,
  "@x402/svm/exact/client": x402Stub,
  "@x402/extensions$": x402Stub,
};

const nextConfig: NextConfig = {
  // Keep our AGENTS.md; Next 16.3 otherwise appends a generic rules block on `next dev`.
  agentRules: false,
  async redirects() {
    return [
      {
        source: '/transact',
        destination: '/vaults',
        permanent: true,
      },
    ];
  },
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    
    // Force singleton resolution of wagmi / React Query (avoids duplicate context)
    config.resolve.alias = {
      ...config.resolve.alias,
      'wagmi': path.join(process.cwd(), 'node_modules/wagmi'),
      '@tanstack/react-query': path.join(process.cwd(), 'node_modules/@tanstack/react-query'),
      ...x402Alias,
      '../build/polyfills/polyfill-module': false,
      'next/dist/build/polyfills/polyfill-module': false,
    };

    // Exclude system directories from watching
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        "**/.Trash/**",
        "**/Library/**",
        "**/.Trash-*/**",
      ],
    };
    return config;
  },
  turbopack: {
    // Set root directory to silence lockfile warning
    root: process.cwd(),
    // Turbopack aliases to match Webpack aliases for singleton resolution
    resolveAlias: {
      'wagmi': './node_modules/wagmi',
      '@tanstack/react-query': './node_modules/@tanstack/react-query',
      '@x402/core': './src/lib/x402-stub.js',
      '@x402/core/client': './src/lib/x402-stub.js',
      '@x402/evm': './src/lib/x402-stub.js',
      '@x402/evm/exact/client': './src/lib/x402-stub.js',
      '@x402/evm/upto/client': './src/lib/x402-stub.js',
      '@x402/svm': './src/lib/x402-stub.js',
      '@x402/svm/exact/client': './src/lib/x402-stub.js',
      '@x402/extensions': './src/lib/x402-stub.js',
      '../build/polyfills/polyfill-module': './src/lib/modern-polyfill.js',
      'next/dist/build/polyfills/polyfill-module': './src/lib/modern-polyfill.js',
    },
    // Turbopack configuration to prevent scanning system directories
    resolveExtensions: [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".json",
      ".mjs",
      ".cjs",
    ],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "static.alchemyapi.io",
      },
    ],
  },
};

export default nextConfig;