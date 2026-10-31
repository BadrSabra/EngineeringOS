---
name: Replit dev-banner base path
description: The Replit development banner injects a root-absolute script URL that fails in path-routed artifacts.
---

For path-routed Replit artifacts, include `@replit/vite-plugin-dev-banner` only when `BASE_PATH` is `/`. The plugin injects its client script at the origin root, which bypasses an artifact mounted under a path such as `/dashboard/` and returns 404.

**Why:** The broken script generated browser-console errors on the dashboard even though the page and HMR otherwise worked.

**How to apply:** When configuring the dev-banner in Vite, check the artifact's `BASE_PATH`; omit the plugin for non-root paths. Keep the rest of the development plugins unchanged.
