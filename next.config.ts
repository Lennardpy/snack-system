import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Product images served via /api/images/products/[filename] (Railway volume),
    // plus static assets in /public (logo, etc.)
    localPatterns: [
      { pathname: "/api/images/**" },
      { pathname: "/*.svg" },
      { pathname: "/*.png" },
    ],
  },
};

export default nextConfig;
