import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Reads the request config from ./src/i18n/request.ts by default.
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
