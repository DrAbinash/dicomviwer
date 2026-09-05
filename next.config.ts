import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
  turbopack: {},
};

export default nextConfig;
