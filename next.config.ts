import type {NextConfig} from 'next';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const pdfjsDistMin = require.resolve('pdfjs-dist/build/pdf.min.mjs');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify — file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
      'pdfjs-dist$': pdfjsDistMin,
    };

    return config;
  },
  devIndicators: {
    // These are deprecated in v15 and no longer configurable
  },
};

export default nextConfig;
