/** @type {import('next').NextConfig} */
const nextConfig = {
  // whatsapp-web.js (Puppeteer, LocalAuth, optional RemoteAuth deps) must run
  // as a plain Node require at runtime — never bundled by webpack.
  serverExternalPackages: ["whatsapp-web.js"],
  experimental: {
    // The domain uses TypeScript ESM-style `.js` import suffixes
    // (e.g. `from "./client.js"` for `./client.ts`). Teach webpack to
    // resolve them so the existing modules work unchanged.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    },
  },
};

export default nextConfig;
