/** @type {import('next').NextConfig} */
const path = require("path");
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../"),
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : []), "@grpc/grpc-js", "@grpc/proto-loader", "rpc-websockets", "ws", "bufferutil", "utf-8-validate"];
    } else {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false, dns: false, http2: false, crypto: require.resolve("crypto-browserify"), stream: require.resolve("stream-browserify"), buffer: require.resolve("buffer") };
      config.plugins.push(new (require("webpack").ProvidePlugin)({ Buffer: ["buffer", "Buffer"], process: "process/browser" }));
    }
    return config;
  },
};
module.exports = nextConfig;