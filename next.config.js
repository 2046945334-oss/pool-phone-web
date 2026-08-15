/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('better-sqlite3')
    }
    // Import .html files as raw strings
    config.module.rules.push({
      test: /\.html$/,
      type: 'asset/source',
    })
    return config
  },
  output: 'standalone',
}
module.exports = nextConfig
