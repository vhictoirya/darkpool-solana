/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../'),
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer'),
      http2: false,
      net: false,
      tls: false,
      dns: false,
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      '@sdk': path.join(__dirname, '../sdk'),
    };
    config.plugins.push(
      new (require('webpack').ProvidePlugin)({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser',
      })
    );
    config.externals = [...(config.externals || []), '@grpc/grpc-js', '@grpc/proto-loader'];
    return config;
  },
};
module.exports = nextConfig;
