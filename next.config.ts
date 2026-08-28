import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep our AGENTS.md; Next 16.3 otherwise appends a generic rules block on `next dev`.
  agentRules: false,
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    
    // Force singleton resolution of wagmi / React Query (avoids duplicate context)
    config.resolve.alias = {
      ...config.resolve.alias,
      'wagmi': path.join(process.cwd(), 'node_modules/wagmi'),
      '@tanstack/react-query': path.join(process.cwd(), 'node_modules/@tanstack/react-query'),
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
    remotePatterns: [
      {
        protocol: "https",
        hostname: "static.alchemyapi.io",
      },
    ],
  },
};

export default nextConfig;