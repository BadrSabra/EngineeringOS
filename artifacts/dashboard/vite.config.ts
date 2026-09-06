import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const buildDefaults = {
  port: '4173',
  basePath: '/dashboard/',
  // This value only makes a clean build possible. Runtime commands still
  // require a real Clerk publishable key below.
  clerkPublishableKey: 'pk_test_build_only_placeholder',
} as const;

const developmentPlugins =
  process.env.NODE_ENV !== 'production' && process.env.REPL_ID !== undefined
    ? [
        await import('@replit/vite-plugin-cartographer').then((m) =>
          m.cartographer({
            root: path.resolve(import.meta.dirname, '..'),
          }),
        ),
        await import('@replit/vite-plugin-dev-banner').then((m) =>
          m.devBanner(),
        ),
      ]
    : [];

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  const rawPort =
    process.env.PORT ??
    (isBuild ? process.env.BUILD_PORT ?? buildDefaults.port : undefined);

  if (!rawPort) {
    throw new Error(
      'PORT environment variable is required but was not provided.',
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath =
    process.env.BASE_PATH ??
    (isBuild ? process.env.BUILD_BASE_PATH ?? buildDefaults.basePath : undefined);
  const apiProxyTarget = process.env.API_PROXY_TARGET;
  // Replit provisions the publishable key as a managed environment secret. Vite
  // only exposes VITE_* variables by default, so explicitly bridge the public
  // key when the workflow provides the canonical CLERK_PUBLISHABLE_KEY name.
  // Never bridge CLERK_SECRET_KEY or any other server-only credential.
  const clerkPublishableKey =
    process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    (isBuild ? buildDefaults.clerkPublishableKey : undefined);

  if (!basePath) {
    throw new Error(
      'BASE_PATH environment variable is required but was not provided.',
    );
  }

  if (!clerkPublishableKey) {
    throw new Error(
      'Clerk public configuration is missing. Provision VITE_CLERK_PUBLISHABLE_KEY or CLERK_PUBLISHABLE_KEY before starting the dashboard.',
    );
  }

  return {
    base: basePath,
    define: {
      'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY':
        JSON.stringify(clerkPublishableKey),
    },
    plugins: [
      react(),
      tailwindcss({ optimize: false }),
      runtimeErrorOverlay(),
      ...developmentPlugins,
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      ...(apiProxyTarget
        ? {
            proxy: {
              '/api': {
                target: apiProxyTarget,
                changeOrigin: false,
              },
            },
          }
        : {}),
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
