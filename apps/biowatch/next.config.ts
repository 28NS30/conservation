import type { NextConfig } from "next";

/**
 * Nothing to proxy: each project is served from its own subdomain, so this app
 * only ever serves itself and links out.
 */
const config: NextConfig = {};

export default config;
