import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Product images served via /api/images/products/[filename] (Railway volume)
    localPatterns: [
      { pathname: "/api/images/**" },
    ],
  },
};

export default nextConfig;
