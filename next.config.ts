import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  // Don't advertise the framework in every response (X-Powered-By: Next.js).
  poweredByHeader: false,
  experimental: {
    // Brand image uploads are capped at 1 MB by the app; leave room for multipart overhead.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
