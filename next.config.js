/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next dev` keeps CSS and route chunks in memory while `next build` writes
  // production artifacts to disk. Separating their output directories prevents
  // a build from replacing assets that an active development server is serving.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
};

module.exports = nextConfig;
