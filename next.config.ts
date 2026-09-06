import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pin the tracing root: the sandbox has multiple lockfiles, which makes
  // Next infer the wrong workspace root and nest the standalone output
  outputFileTracingRoot: __dirname,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  transpilePackages: [
    "@cornerstonejs/core",
    "@cornerstonejs/tools",
    "@cornerstonejs/dicom-image-loader",
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // `canvas` is a Node-only optional dependency of @cornerstonejs/tools
      canvas: false,
    };
    // WASM codecs (charls/openjpeg/etc.) contain Emscripten Node branches
    // that require('fs') - stub them out for the browser bundle.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      url: false,
      crypto: false,
    };
    return config;
  },
  turbopack: {
    // small NAS/CI containers OOM-kill the build without a cap (seen at ~2.3GB
    // anon-rss on a 4GB box); GC harder and stay under the ceiling
    // (option is valid at runtime but missing from the published TS types)
    ...({ memoryLimit: 2048 } as object),
  } as NextConfig["turbopack"],
};

export default nextConfig;
