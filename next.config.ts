import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow locally uploaded product images served from /public/uploads/
    localPatterns: [
      { pathname: "/uploads/**" },
    ],
  },
};

export default nextConfig;
