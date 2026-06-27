/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static HTML export for Firebase Hosting. Emits to ./out.
  output: "export",
  // next/image optimization requires a server; disable it for static export.
  images: { unoptimized: true },
};

export default nextConfig;
