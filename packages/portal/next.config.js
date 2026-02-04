/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    transpilePackages: ['@trcoder/auth', '@trcoder/billing'],
}

module.exports = nextConfig
