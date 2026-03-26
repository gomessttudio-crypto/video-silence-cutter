import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  serverExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg', 'busboy'],
}

export default nextConfig
