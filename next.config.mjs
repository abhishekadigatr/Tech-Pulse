/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Arena preview is served from https://<port>-<sandbox>.e2b.app. Next 15
  // blocks cross-origin dev asset requests unless the origin is explicitly trusted.
  allowedDevOrigins: ['*.e2b.app'],
  experimental: {
    serverActions: { allowedOrigins: ['*.e2b.app'] },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
    ];
  },
};

export default nextConfig;
