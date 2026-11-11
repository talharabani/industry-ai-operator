import type { NextConfig } from 'next';
import path from 'path';

// Force REACT_EDITOR and LAUNCH_EDITOR to 'none' to permanently disable editor child process spawning on Windows
process.env.REACT_EDITOR = 'none';
process.env.LAUNCH_EDITOR = 'none';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ['unrarefied-soo-rustiest.ngrok-free.dev'],
  experimental: {
    workerThreads: true,
    turbopackPluginRuntimeStrategy: 'workerThreads',
  },
};

export default nextConfig;




