import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export served from S3 + CloudFront; the API lives under /api.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
