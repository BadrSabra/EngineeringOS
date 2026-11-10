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
        // The plugin injects its script at the origin root. Path-routed
        // artifacts are served under BASE_PATH, so that request misses the
        // artifact router and returns 404. Keep it only for root-mounted apps.
        ...(process.env.BASE_PATH === '/'
          ? [
              await import('@replit/vite-plugin-dev-banner').then((m) =>
                m.devBanner(),
              ),
            ]
          : []),
      ]
    : [];

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  const localAuthFixtureRequested =
    process.env.DASHBOARD_E2E_LOCAL_AUTH_FIXTURE === '1';
  const protectedVisualFixtureRequested =
    process.env.DASHBOARD_E2E_PROTECTED_VISUAL === '1';
  const protectedVisualFixtureEnabled =
    !isBuild &&
    command === 'serve' &&
    protectedVisualFixtureRequested &&
    localAuthFixtureRequested &&
    process.env.RUN_CONTROLLED_RELEASE_VALIDATION === '1' &&
    process.env.DASHBOARD_E2E_TEST_MODE === 'fixture' &&
    process.env.HOST === '127.0.0.1' &&
    !process.env.API_PROXY_TARGET &&
    !process.env.CLERK_SECRET_KEY &&
    !process.env.CLERK_PUBLISHABLE_KEY &&
    !process.env.VITE_CLERK_PUBLISHABLE_KEY;
  const localAuthFixtureEnabled =
    (
      !isBuild &&
      command === 'serve' &&
      localAuthFixtureRequested &&
      process.env.RUN_CONTROLLED_RELEASE_VALIDATION === '1' &&
      process.env.ENGINEERING_AGENT_LIFECYCLE_E2E === '1' &&
      process.env.DASHBOARD_E2E_TEST_MODE === 'fixture' &&
      process.env.HOST === '127.0.0.1'
    ) ||
    protectedVisualFixtureEnabled;

  if (localAuthFixtureRequested && !localAuthFixtureEnabled) {
    throw new Error(
      'The local Clerk fixture is restricted to a loopback controlled fixture journey.',
    );
  }
  if (protectedVisualFixtureRequested && !protectedVisualFixtureEnabled) {
    throw new Error(
      'Protected visual E2E requires local auth, fixture mode, loopback binding, no API proxy, and no Clerk credentials.',
    );
  }

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
    (localAuthFixtureEnabled
      ? 'pk_test_engineeringos_local_fixture'
      : process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
        process.env.CLERK_PUBLISHABLE_KEY?.trim()) ||
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
      ...(protectedVisualFixtureEnabled
        ? [
            {
              name: 'protected-visual-disable-remote-fonts',
              enforce: 'pre' as const,
              transformIndexHtml(html: string) {
                return html.replace(
                  /<link\b(?=[^>]*\bhref=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com)[^>]*>\s*/giu,
                  '',
                );
              },
              transform(code: string, id: string) {
                if (!id.split('?')[0].endsWith('/src/index.css')) return null;
                return {
                  code: code.replace(
                    /^@import\s+url\((['"]?)https:\/\/fonts\.googleapis\.com[^)]*\)\s*;\s*/mu,
                    '',
                  ),
                  map: null,
                };
              },
            },
          ]
        : []),
      react(),
      tailwindcss({ optimize: false }),
      runtimeErrorOverlay(),
      ...developmentPlugins,
    ],
    resolve: {
      alias: {
        ...(localAuthFixtureEnabled
          ? {
              '@clerk/react/internal': path.resolve(
                import.meta.dirname,
                'e2e/fixtures/local-clerk-internal.ts',
              ),
              '@clerk/react': path.resolve(
                import.meta.dirname,
                'e2e/fixtures/local-clerk-react.tsx',
              ),
              '@clerk/themes': path.resolve(
                import.meta.dirname,
                'e2e/fixtures/local-clerk-themes.ts',
              ),
            }
          : {}),
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
      host: localAuthFixtureEnabled ? '127.0.0.1' : '0.0.0.0',
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
