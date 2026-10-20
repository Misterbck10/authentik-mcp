import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output lets the same build run in Docker (`next start` / node server.js).
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
